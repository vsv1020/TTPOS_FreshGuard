import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:hive/hive.dart';

/// A batch-generation print request captured while the device was offline.
/// Replayed against `POST /api/store/print` once connectivity returns.
class OfflinePrintRequest {
  OfflinePrintRequest({
    required this.id,
    required this.productId,
    required this.productName,
    required this.quantity,
    this.staffId,
    required this.createdAt,
    this.lastError,
  });

  final int id;
  final int productId;
  final String productName;
  final int quantity;
  final int? staffId;

  /// ISO-8601 local timestamp of when the request was queued.
  final String createdAt;

  /// Last non-network submit failure (server rejection), if any.
  String? lastError;

  Map<String, dynamic> toJson() => {
        'id': id,
        'productId': productId,
        'productName': productName,
        'quantity': quantity,
        if (staffId != null) 'staffId': staffId,
        'createdAt': createdAt,
        if (lastError != null) 'lastError': lastError,
      };

  factory OfflinePrintRequest.fromJson(Map<String, dynamic> json) {
    return OfflinePrintRequest(
      id: (json['id'] as num).toInt(),
      productId: (json['productId'] as num).toInt(),
      productName: json['productName'] as String? ?? '?',
      quantity: (json['quantity'] as num).toInt(),
      staffId: (json['staffId'] as num?)?.toInt(),
      createdAt: json['createdAt'] as String? ?? '',
      lastError: json['lastError'] as String?,
    );
  }
}

/// Persistent FIFO queue of offline print requests, backed by a Hive box so
/// pending uploads survive app restarts.
class OfflinePrintQueue extends ChangeNotifier {
  OfflinePrintQueue(this._box) {
    _load();
  }

  static const boxName = 'freshguard_offline_prints';
  static const _itemsKey = 'requests';

  final Box<String> _box;
  final List<OfflinePrintRequest> _items = [];
  int _nextId = 1;
  bool _flushing = false;

  static Future<OfflinePrintQueue> open() async {
    return OfflinePrintQueue(await Hive.openBox<String>(boxName));
  }

  List<OfflinePrintRequest> get items => List.unmodifiable(_items);

  bool get isFlushing => _flushing;

  void _load() {
    final raw = _box.get(_itemsKey);
    if (raw == null) {
      return;
    }
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      _items.addAll(
        list.map((e) => OfflinePrintRequest.fromJson(e as Map<String, dynamic>)),
      );
      for (final item in _items) {
        if (item.id >= _nextId) {
          _nextId = item.id + 1;
        }
      }
    } catch (_) {
      // Corrupt persisted state: start with an empty queue.
      _items.clear();
    }
  }

  Future<void> _persist() async {
    await _box.put(
      _itemsKey,
      jsonEncode(_items.map((e) => e.toJson()).toList()),
    );
  }

  Future<OfflinePrintRequest> add({
    required int productId,
    required String productName,
    required int quantity,
    int? staffId,
  }) async {
    final request = OfflinePrintRequest(
      id: _nextId++,
      productId: productId,
      productName: productName,
      quantity: quantity,
      staffId: staffId,
      createdAt: DateTime.now().toIso8601String(),
    );
    _items.add(request);
    await _persist();
    notifyListeners();
    return request;
  }

  Future<void> remove(int id) async {
    _items.removeWhere((e) => e.id == id);
    await _persist();
    notifyListeners();
  }

  /// Replays pending requests in order. [submit] must throw on failure.
  ///
  /// - Success: the request is removed from the queue.
  /// - [isNetworkError] failure: still offline — the flush stops and every
  ///   remaining request stays queued for the next attempt.
  /// - Other failure (server rejection): the error is recorded on the item
  ///   (visible in the UI, deletable by the user) and the flush continues.
  Future<void> flush({
    required Future<void> Function(OfflinePrintRequest request) submit,
    required bool Function(Object error) isNetworkError,
  }) async {
    if (_flushing || _items.isEmpty) {
      return;
    }
    _flushing = true;
    notifyListeners();
    try {
      for (final request in List.of(_items)) {
        try {
          await submit(request);
          _items.removeWhere((e) => e.id == request.id);
          await _persist();
          notifyListeners();
        } catch (error) {
          request.lastError = error.toString().replaceFirst('Exception: ', '');
          await _persist();
          notifyListeners();
          if (isNetworkError(error)) {
            return;
          }
        }
      }
    } finally {
      _flushing = false;
      notifyListeners();
    }
  }
}

/// List of pending offline print requests with delete + manual upload.
/// Renders nothing while the queue is empty.
class OfflinePrintQueueSection extends StatelessWidget {
  const OfflinePrintQueueSection({
    super.key,
    required this.queue,
    this.onUploadNow,
  });

  final OfflinePrintQueue queue;
  final VoidCallback? onUploadNow;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: queue,
      builder: (context, _) {
        if (queue.items.isEmpty) {
          return const SizedBox.shrink();
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Offline upload queue',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton(
                  onPressed: queue.isFlushing ? null : onUploadNow,
                  child: Text(queue.isFlushing ? 'Uploading…' : 'Upload now'),
                ),
              ],
            ),
            ...queue.items.map(
              (item) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    const Icon(Icons.cloud_off, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '#${item.id} ${item.productName} ×${item.quantity}'
                        ' — queued ${item.createdAt}'
                        '${item.lastError != null ? '\nLast error: ${item.lastError}' : ''}',
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Delete pending request',
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed:
                          queue.isFlushing ? null : () => queue.remove(item.id),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

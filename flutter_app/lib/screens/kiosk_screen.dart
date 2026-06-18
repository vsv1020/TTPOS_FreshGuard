import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../color_codes.dart';
import '../models.dart';
import '../network.dart';
import '../paging.dart';
import '../printer/ble_transport.dart';
import '../printer/network_transport.dart';
import '../printer/printer_settings.dart';
import '../printer/printer_settings_store.dart';
import '../printer/spp_transport.dart';
import '../printer/transport.dart';
import '../printer/usb_printer.dart';
import '../printer/usb_transport.dart';
import '../printing/offline_print_queue.dart';
import '../printing/print_queue.dart';
import '../session.dart';
import '../storage/local_cache.dart';
import 'dashboard_screen.dart';

/// Full-screen one-tap-to-print kiosk. Replaces [DashboardScreen] as the
/// runtime home for a bound device: products render as a big tile grid and a
/// single tap prints one label, reusing the persisted printer the admin saved.
///
/// The full admin dashboard (printer setup, reminders, reprint, multi-copy,
/// staff PIN) is reachable only via the admin escape hatch — a long-press on
/// the AppBar title pushes [DashboardScreen].
class KioskScreen extends StatefulWidget {
  const KioskScreen({
    super.key,
    required this.session,
    required this.onLogout,
  });

  final AppSession session;
  final VoidCallback onLogout;

  @override
  State<KioskScreen> createState() => _KioskScreenState();
}

class _KioskScreenState extends State<KioskScreen> {
  late final ApiClient _api;

  /// Registered printer transports. Each is filtered out when not available on
  /// the running platform (USB/SPP are Android-only).
  final List<PrinterTransport> _transports = [
    UsbTransport(),
    BleTransport(),
    SppTransport(),
    const NetworkTransport(),
  ];
  final PrintQueue _printQueue = PrintQueue();

  static const _pageSize = 20;

  List<ProductItem> _products = [];
  bool _productsHasMore = false;
  bool _loadingMoreProducts = false;
  bool _busy = false;

  /// Resolved from the admin-saved [PrinterSettings]; null means no printer is
  /// configured and the grid is replaced by a "contact admin" panel.
  PrinterProfile _printerProfile = PrinterProfile.tspl;
  PrinterEndpoint? _endpoint;
  PrinterTransport? _transport;

  /// Products in their post-print cooldown (tile dimmed, taps ignored).
  /// Doubles as the double-tap / duplicate-batch guard.
  final Set<int> _cooldownProductIds = {};
  final Map<int, Timer> _cooldownTimers = {};

  // Offline support (null when local storage could not be opened).
  LocalCache? _cache;
  OfflinePrintQueue? _offlineQueue;
  DateTime? _offlineDataAt;
  Timer? _offlineFlushTimer;

  @override
  void initState() {
    super.initState();
    _api = ApiClient(baseUrl: widget.session.baseUrl, token: widget.session.token);
    _initialize();
  }

  Future<void> _initialize() async {
    await _openLocalStores();
    await _loadPrinterSettings();
    await _loadProducts();
  }

  Future<void> _openLocalStores() async {
    try {
      _cache = await LocalCache.open();
      _api.cache = _cache;
      _offlineQueue = await OfflinePrintQueue.open();
      _offlineFlushTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _flushOfflineQueue(),
      );
      if (mounted) {
        // Surface any offline print requests persisted from a previous run.
        setState(() {});
      }
    } catch (_) {
      // Hive not initialized (e.g. unit tests): offline features stay off.
    }
  }

  /// Loads the admin-saved printer and resolves the live endpoint + transport.
  /// The kiosk never configures the printer; it only consumes the saved one.
  Future<void> _loadPrinterSettings() async {
    final settings = await PrinterSettingsStore.load();
    if (settings == null || !mounted) {
      return;
    }
    final endpoint = PrinterSettingsStore.resolveEndpoint(settings);
    final transport = endpoint == null
        ? null
        : _transports
            .where((t) => t.type == endpoint.transport && t.isAvailable)
            .cast<PrinterTransport?>()
            .firstWhere((t) => t != null, orElse: () => null);
    setState(() {
      _printerProfile = settings.profile;
      _endpoint = transport == null ? null : endpoint;
      _transport = transport;
    });
  }

  Future<void> _loadProducts() async {
    setState(() {
      _busy = true;
    });
    try {
      final products = await _api.fetchProducts(limit: _pageSize);
      if (!mounted) {
        return;
      }
      setState(() {
        _products = products.items;
        _productsHasMore = products.hasMoreAfter(0);
        _offlineDataAt = null;
      });
      // Back online: replay any print requests captured while offline.
      _flushOfflineQueue();
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (isNetworkError(error) && _showCachedData()) {
        return;
      }
      _snack(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  /// Shows the last cached products when the network is down.
  /// Returns true when cached data was displayed.
  bool _showCachedData() {
    final entry = _cache?.getJson('products');
    if (entry == null) {
      return false;
    }
    try {
      final products = PagedResult.parse(entry.data, 'products', ProductItem.fromJson);
      setState(() {
        _products = products.items;
        _productsHasMore = false;
        _offlineDataAt = entry.savedAt;
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _loadMoreProducts() async {
    if (_busy || _loadingMoreProducts || !_productsHasMore) {
      return;
    }
    _loadingMoreProducts = true;
    final offset = _products.length;
    try {
      final result = await _api.fetchProducts(limit: _pageSize, offset: offset);
      if (!mounted) {
        return;
      }
      setState(() {
        _products = [..._products, ...result.items];
        _productsHasMore = result.hasMoreAfter(offset);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      _snack(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      _loadingMoreProducts = false;
    }
  }

  /// Replays offline print requests in order: regenerates the batch on the
  /// server, then prints the returned label when a printer is configured.
  Future<void> _flushOfflineQueue() async {
    final queue = _offlineQueue;
    if (queue == null || queue.items.isEmpty || queue.isFlushing) {
      return;
    }
    await queue.flush(
      isNetworkError: isNetworkError,
      submit: (request) async {
        final result = await _api.printLabels(
          productId: request.productId,
          quantity: request.quantity,
          staffId: request.staffId,
        );
        if (!mounted) {
          return;
        }
        final endpoint = _endpoint;
        final transport = _transport;
        if (endpoint != null && transport != null && result.labelData != null) {
          final bytes = LabelCommandBuilder.buildLabel(
            profile: _printerProfile,
            data: result.labelData!,
          );
          _printQueue.enqueue(
            description:
                'Offline batch #${result.batchId} (${request.productName} ×${request.quantity})',
            pages: List<Uint8List>.filled(request.quantity, bytes),
            writer: (b) => transport.send(endpoint, [b]),
          );
        }
      },
    );
  }

  /// Single-tap handler: prints exactly one label for [product].
  ///
  /// Quantity is hard-fixed to 1; repeat taps print repeat singles. A
  /// per-product 3s cooldown (added synchronously before the await) debounces a
  /// shaky finger and prevents duplicate server batches.
  Future<void> _printOne(ProductItem product) async {
    final endpoint = _endpoint;
    final transport = _transport;
    if (endpoint == null || transport == null) {
      // Defensive: the grid is not shown without a printer, so this is
      // unreachable from a tile — early-return keeps it safe.
      return;
    }
    if (_cooldownProductIds.contains(product.id)) {
      return;
    }

    setState(() {
      _cooldownProductIds.add(product.id);
    });
    _cooldownTimers[product.id]?.cancel();
    _cooldownTimers[product.id] = Timer(const Duration(seconds: 3), () {
      _cooldownTimers.remove(product.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _cooldownProductIds.remove(product.id);
      });
    });

    try {
      final result = await _api.printLabels(productId: product.id, quantity: 1);
      if (!mounted) {
        return;
      }
      final label = result.labelData;
      if (label != null) {
        final bytes = LabelCommandBuilder.buildLabel(
          profile: _printerProfile,
          data: label,
        );
        _printQueue.enqueue(
          description: '${product.name} ×1',
          pages: [bytes],
          writer: (b) => transport.send(endpoint, [b]),
        );
      }
      _snack('Printed ${product.name} — expires ${label?.expiresAt ?? '-'}');
    } catch (error) {
      if (!mounted) {
        return;
      }
      final queue = _offlineQueue;
      if (isNetworkError(error) && queue != null) {
        // Offline: keep the request locally; the 30s flush replays it.
        await queue.add(
          productId: product.id,
          productName: product.name,
          quantity: 1,
          staffId: null,
        );
        if (!mounted) {
          return;
        }
        _snack('Queued ${product.name} — will print when back online');
      } else {
        _snack(error.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  void _snack(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message, style: const TextStyle(fontSize: 16))),
      );
  }

  void _openAdminDashboard() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DashboardScreen(
          session: widget.session,
          onLogout: widget.onLogout,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _offlineFlushTimer?.cancel();
    for (final timer in _cooldownTimers.values) {
      timer.cancel();
    }
    _printQueue.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          // Admin escape hatch: long-press the title to open the full dashboard.
          onLongPress: _openAdminDashboard,
          child: Text('${widget.session.brandName} / ${widget.session.storeName}'),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh products',
            onPressed: _busy ? null : _loadProducts,
            icon: const Icon(Icons.refresh),
          ),
          _PrinterStatusChip(queue: _printQueue, hasEndpoint: _endpoint != null),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          if (_busy) const LinearProgressIndicator(),
          _PrinterStatusBanner(queue: _printQueue, hasEndpoint: _endpoint != null),
          if (_offlineDataAt != null)
            Container(
              width: double.infinity,
              color: Colors.amber.shade100,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.cloud_off, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '离线数据,更新于 ${_formatLocalTime(_offlineDataAt!)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_endpoint == null) {
      return _buildCenteredPanel(
        icon: Icons.print_disabled,
        title: 'Printer not configured',
        subtitle: 'Contact an administrator to set up the printer\n'
            '(long-press the title to open admin settings).',
      );
    }
    if (_products.isEmpty) {
      return _buildCenteredPanel(
        icon: Icons.inventory_2_outlined,
        title: 'No products',
        subtitle: 'No products are available for this store brand yet.',
      );
    }
    return LoadMoreOnScroll(
      onLoadMore: _loadMoreProducts,
      child: GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          childAspectRatio: 1.0,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
        ),
        itemCount: _products.length + (_productsHasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _products.length) {
            return const Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            );
          }
          final product = _products[index];
          return _ProductTile(
            product: product,
            cooling: _cooldownProductIds.contains(product.id),
            onTap: () => _printOne(product),
          );
        },
      ),
    );
  }

  Widget _buildCenteredPanel({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  String _formatLocalTime(DateTime time) {
    final t = time.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}';
  }
}

/// One product tile: color stripe header, large product name, and a footer with
/// shelf-life + language badge. Dims with a "Printed" overlay during cooldown.
class _ProductTile extends StatelessWidget {
  const _ProductTile({
    required this.product,
    required this.cooling,
    required this.onTap,
  });

  final ProductItem product;
  final bool cooling;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final stripe = colorCodeColor(product.colorCode);
    final tile = Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: cooling ? null : onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 24, color: stripe ?? Colors.transparent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Center(
                  child: Text(
                    product.name,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${product.shelfLifeDays}d',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  _LanguageBadge(labelLanguage: product.labelLanguage),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    if (!cooling) {
      return tile;
    }
    return Stack(
      fit: StackFit.expand,
      children: [
        Opacity(opacity: 0.4, child: tile),
        Container(
          decoration: BoxDecoration(
            color: Colors.green.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.check_circle, color: Colors.green, size: 40),
              SizedBox(height: 8),
              Text(
                'Printed',
                style: TextStyle(
                  color: Colors.green,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Compact language badge derived from a product's label-language code
/// (e.g. 'zh' -> 'ZH', 'zh-en' / 'zh,en' -> 'ZH·EN').
class _LanguageBadge extends StatelessWidget {
  const _LanguageBadge({required this.labelLanguage});

  final String labelLanguage;

  String get _text {
    final parts = labelLanguage
        .split(RegExp(r'[\s,;·|/+-]+'))
        .where((p) => p.trim().isNotEmpty)
        .map((p) => p.trim().toUpperCase())
        .toList();
    if (parts.isEmpty) {
      return labelLanguage.toUpperCase();
    }
    return parts.join('·');
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        _text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.onSecondaryContainer,
        ),
      ),
    );
  }
}

/// Derives a coarse printer-readiness verdict from the saved-endpoint check
/// and the live [PrintQueue] state.
enum _PrinterState { ready, offline, none }

_PrinterState _resolvePrinterState(PrintQueue queue, bool hasEndpoint) {
  if (!hasEndpoint) {
    return _PrinterState.none;
  }
  final hasFailed = queue.jobs.any((j) => j.isFailed);
  return hasFailed ? _PrinterState.offline : _PrinterState.ready;
}

/// Always-visible banner reflecting printer readiness: green ready, amber
/// offline/queued (a job failed its retries), red no-printer.
class _PrinterStatusBanner extends StatelessWidget {
  const _PrinterStatusBanner({required this.queue, required this.hasEndpoint});

  final PrintQueue queue;
  final bool hasEndpoint;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: queue,
      builder: (context, _) {
        final state = _resolvePrinterState(queue, hasEndpoint);
        final (color, icon, text) = switch (state) {
          _PrinterState.ready => (Colors.green, Icons.print, 'Printer ready'),
          _PrinterState.offline => (
              Colors.amber.shade800,
              Icons.cloud_off,
              'Printer error — job queued, retrying',
            ),
          _PrinterState.none => (
              Colors.red,
              Icons.print_disabled,
              'No printer — contact admin',
            ),
        };
        return Container(
          width: double.infinity,
          color: color.withValues(alpha: 0.12),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 8),
              Text(
                text,
                style: TextStyle(color: color, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// AppBar status chip mirroring [_PrinterStatusBanner]'s verdict.
class _PrinterStatusChip extends StatelessWidget {
  const _PrinterStatusChip({required this.queue, required this.hasEndpoint});

  final PrintQueue queue;
  final bool hasEndpoint;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: queue,
      builder: (context, _) {
        final state = _resolvePrinterState(queue, hasEndpoint);
        final color = switch (state) {
          _PrinterState.ready => Colors.green,
          _PrinterState.offline => Colors.amber.shade800,
          _PrinterState.none => Colors.red,
        };
        return Center(
          child: Container(
            width: 12,
            height: 12,
            margin: const EdgeInsets.only(right: 4),
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
        );
      },
    );
  }
}

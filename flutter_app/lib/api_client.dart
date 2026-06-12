import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';
import 'paging.dart';
import 'printer/usb_printer.dart';
import 'session.dart';
import 'storage/local_cache.dart';

class ApiClient {
  ApiClient({required this.baseUrl, this.token, this.cache});

  final String baseUrl;
  final String? token;

  /// When set, first-page products/reminders responses are cached for
  /// offline display. Attached after the Hive box opens.
  LocalCache? cache;

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (token != null && token!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    http.Response response;
    if (method == 'POST') {
      response = await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    } else {
      response = await http.get(uri, headers: headers);
    }

    // Tolerate non-JSON bodies (e.g. plain-text 429s from proxies/rate
    // limiters) so errors surface as "HTTP <code>" instead of a decode crash.
    dynamic parsed = <String, dynamic>{};
    if (response.body.isNotEmpty) {
      try {
        parsed = jsonDecode(response.body);
      } on FormatException {
        parsed = <String, dynamic>{};
      }
    }

    if (response.statusCode >= 400) {
      final error = parsed is Map<String, dynamic>
          ? (parsed['error']?.toString() ??
              parsed['message']?.toString() ??
              'HTTP ${response.statusCode}')
          : 'HTTP ${response.statusCode}';
      throw Exception(error);
    }

    return parsed;
  }

  Future<AppSession> bindStore({required String code, required String deviceId}) async {
    final result = await _request(
      '/api/store/bind',
      method: 'POST',
      body: {
        'code': code,
        'deviceId': deviceId,
      },
    );

    final store = result['store'] as Map<String, dynamic>;
    return AppSession(
      baseUrl: baseUrl,
      token: result['token'] as String,
      storeId: (store['id'] as num).toInt(),
      brandId: (store['brandId'] as num).toInt(),
      storeName: store['name'] as String,
      brandName: store['brandName'] as String? ?? 'Brand',
    );
  }

  Future<PagedResult<ProductItem>> fetchProducts({
    int? limit,
    int offset = 0,
    String? q,
  }) async {
    final params = <String, String>{
      if (limit != null) 'limit': '$limit',
      if (limit != null && offset > 0) 'offset': '$offset',
      if (q != null && q.isNotEmpty) 'q': q,
    };
    final query = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final result = await _request('/api/store/products$query');
    if (offset == 0 && (q == null || q.isEmpty)) {
      await cache?.putJson('products', result);
    }
    return PagedResult.parse(result, 'products', ProductItem.fromJson);
  }

  Future<List<StaffItem>> fetchStaff() async {
    final result = await _request('/api/store/staff');
    final items = result['staff'] as List<dynamic>? ?? [];
    return items.map((item) => StaffItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<bool> verifyStaffPin({required int staffId, required String pin}) async {
    final result = await _request(
      '/api/store/staff/$staffId/verify-pin',
      method: 'POST',
      body: {'pin': pin},
    );
    return result['valid'] == true;
  }

  Future<PrintResult> printLabels({
    required int productId,
    required int quantity,
    int? staffId,
  }) async {
    final body = <String, dynamic>{
      'productId': productId,
      'quantity': quantity,
    };
    if (staffId != null) body['staffId'] = staffId;
    final result = await _request(
      '/api/store/print',
      method: 'POST',
      body: body,
    );

    final batch = result['batch'] as Map<String, dynamic>;
    final label = result['label'] as Map<String, dynamic>?;
    return PrintResult(
      batchId: (batch['id'] as num).toInt(),
      remindersCreated: (result['remindersCreated'] as num).toInt(),
      labelText: label?['text']?.toString() ?? '',
      labelData: label != null ? LabelData.fromBackend(label) : null,
    );
  }

  Future<PagedResult<ReminderItem>> fetchReminders({
    required String status,
    int? limit,
    int offset = 0,
  }) async {
    final params = <String, String>{
      'status': status,
      if (limit != null) 'limit': '$limit',
      if (limit != null && offset > 0) 'offset': '$offset',
    };
    final query = Uri(queryParameters: params).query;
    final result = await _request('/api/store/reminders?$query');
    if (offset == 0) {
      await cache?.putJson('reminders_$status', result);
    }
    return PagedResult.parse(result, 'reminders', ReminderItem.fromJson);
  }

  /// Looks up a batch (and its pending reminder, if any) from a scanned
  /// label barcode. Returns the raw `{batch, reminder}` payload; throws with
  /// the server message on 404.
  Future<Map<String, dynamic>> fetchBatchByBarcode(String code) async {
    final query = Uri(queryParameters: {'code': code}).query;
    final result = await _request('/api/store/batches/by-barcode?$query');
    return result as Map<String, dynamic>;
  }

  /// Re-renders the label data for a historical batch. The response shape
  /// matches the `label` object returned by `/api/store/print`.
  Future<LabelData> fetchBatchLabel(int batchId) async {
    final result = await _request('/api/store/batches/$batchId/label');
    final map = result as Map<String, dynamic>;
    final label = map['label'] is Map<String, dynamic>
        ? map['label'] as Map<String, dynamic>
        : map;
    return LabelData.fromBackend(label);
  }

  Future<void> handleReminder({
    required int reminderId,
    required String reason,
    int? staffId,
  }) async {
    final body = <String, dynamic>{'reason': reason};
    if (staffId != null) body['staffId'] = staffId;
    await _request(
      '/api/store/reminders/$reminderId/handle',
      method: 'POST',
      body: body,
    );
  }
}

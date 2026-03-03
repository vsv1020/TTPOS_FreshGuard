import 'package:http/http.dart' as http;
import 'dart:convert';

class PrintService {
  static const String _apiBase = 'https://api.ttpos.com';
  
  /// 批量打印订单
  static Future<bool> batchPrint(List<String> orderIds) async {
    final response = await http.post(
      Uri.parse('$_apiBase/print/batch'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'order_ids': orderIds}),
    );
    
    return response.statusCode == 200;
  }
  
  /// 获取打印状态
  static Future<Map<String, dynamic>> getPrintStatus(String orderId) async {
    final response = await http.get(
      Uri.parse('$_apiBase/print/status/$orderId'),
    );
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return {'status': 'unknown'};
  }
}

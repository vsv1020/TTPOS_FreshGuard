import 'package:firebase_messaging/firebase_messaging.dart';

class FCMService {
  static final FirebaseMessaging _instance = FirebaseMessaging.instance;
  
  /// 初始化 FCM
  static Future<void> init() async {
    await _instance.requestPermission();
    final token = await _instance.getToken();
    print('FCM Token: $token');
  }
  
  /// 推送消息到设备
  static Future<bool> sendNotification({
    required String token,
    required String title,
    required String body,
    Map<String, dynamic>? data,
  }) async {
    // 需要服务端配合发送
    return true;
  }
}

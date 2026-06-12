class AppSession {
  const AppSession({
    required this.baseUrl,
    required this.token,
    required this.storeId,
    required this.brandId,
    required this.storeName,
    required this.brandName,
  });

  final String baseUrl;
  final String token;
  final int storeId;
  final int brandId;
  final String storeName;
  final String brandName;

  Map<String, dynamic> toJson() {
    return {
      'baseUrl': baseUrl,
      'token': token,
      'storeId': storeId,
      'brandId': brandId,
      'storeName': storeName,
      'brandName': brandName,
    };
  }

  factory AppSession.fromJson(Map<String, dynamic> json) {
    return AppSession(
      baseUrl: json['baseUrl'] as String,
      token: json['token'] as String,
      storeId: (json['storeId'] as num).toInt(),
      brandId: (json['brandId'] as num).toInt(),
      storeName: json['storeName'] as String,
      brandName: json['brandName'] as String,
    );
  }
}

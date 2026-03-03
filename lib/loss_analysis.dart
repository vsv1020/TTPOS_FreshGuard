class LossAnalysis {
  /// 计算损耗率
  static double calculateLossRate(int soldQty, int receivedQty) {
    if (receivedQty == 0) return 0;
    return ((receivedQty - soldQty) / receivedQty) * 100;
  }
  
  /// 获取损耗报表
  static Future<List<LossReport>> getLossReport(DateTime start, DateTime end) async {
    // TODO: 调用 API 获取数据
    return [];
  }
}

class LossReport {
  final String itemName;
  final int receivedQty;
  final int soldQty;
  final double lossRate;
  
  LossReport({
    required this.itemName,
    required this.receivedQty,
    required this.soldQty,
    required this.lossRate,
  });
}

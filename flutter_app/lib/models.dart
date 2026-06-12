import 'printer/usb_printer.dart';
import 'promo.dart';

class ProductItem {
  const ProductItem({
    required this.id,
    required this.name,
    required this.sku,
    required this.shelfLifeDays,
    required this.labelLanguage,
    this.colorCode,
  });

  final int id;
  final String name;
  final String? sku;
  final int shelfLifeDays;
  final String labelLanguage;

  /// 四色色标 code ('red'|'blue'|'green'|'yellow'); null for legacy data.
  final String? colorCode;

  factory ProductItem.fromJson(Map<String, dynamic> json) {
    return ProductItem(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      sku: json['sku'] as String?,
      shelfLifeDays: (json['shelfLifeDays'] as num).toInt(),
      labelLanguage: json['labelLanguage'] as String,
      colorCode: json['colorCode'] as String?,
    );
  }
}

class ReminderItem {
  const ReminderItem({
    required this.id,
    required this.productName,
    required this.expiresAt,
    this.batchId,
    this.isPriority = false,
    this.colorCode,
    this.promo,
  });

  final int id;
  final String productName;
  final String expiresAt;

  /// Source batch; used for label reprint.
  final int? batchId;

  /// FIFO hint from the server: earliest unhandled batch of its product.
  final bool isPriority;

  /// 四色色标 code of the product; null for legacy data.
  final String? colorCode;

  /// 临期促销建议; null when no promo rule matches.
  final ReminderPromo? promo;

  factory ReminderItem.fromJson(Map<String, dynamic> json) {
    return ReminderItem(
      id: (json['id'] as num).toInt(),
      productName: json['productName'] as String,
      expiresAt: json['expiresAt'] as String,
      batchId: (json['batchId'] as num?)?.toInt(),
      isPriority: json['is_priority'] == true || json['isPriority'] == true,
      colorCode: json['colorCode'] as String?,
      promo: ReminderPromo.fromJson(json['promo']),
    );
  }
}

class PrintResult {
  const PrintResult({
    required this.batchId,
    required this.remindersCreated,
    required this.labelText,
    this.labelData,
  });

  final int batchId;
  final int remindersCreated;
  final String labelText;
  final LabelData? labelData;
}

class StaffItem {
  const StaffItem({
    required this.id,
    required this.name,
    required this.role,
  });

  final int id;
  final String name;
  final String role;

  factory StaffItem.fromJson(Map<String, dynamic> json) {
    return StaffItem(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      role: json['role'] as String? ?? 'staff',
    );
  }
}

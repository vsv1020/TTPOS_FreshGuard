import 'package:flutter/material.dart';

/// 临期促销建议，来自 `GET /api/store/reminders` 每条的 `promo` 字段。
class ReminderPromo {
  const ReminderPromo({
    required this.action,
    this.discountPercent,
    this.hoursBeforeExpiry,
  });

  /// `'discount' | 'remove'`（未知值按原文显示，保持向前兼容）。
  final String action;
  final int? discountPercent;
  final num? hoursBeforeExpiry;

  /// Parses the `promo` field; returns null for null/absent/malformed data.
  static ReminderPromo? fromJson(dynamic json) {
    if (json is! Map) {
      return null;
    }
    final action = json['action']?.toString();
    if (action == null || action.isEmpty) {
      return null;
    }
    return ReminderPromo(
      action: action,
      discountPercent: (json['discountPercent'] as num?)?.toInt(),
      hoursBeforeExpiry: json['hoursBeforeExpiry'] as num?,
    );
  }
}

/// 促销建议中文摘要，用于徽标与本地通知正文。
String promoSummaryZh(ReminderPromo promo) {
  switch (promo.action) {
    case 'discount':
      return promo.discountPercent != null
          ? '建议打折 ${promo.discountPercent}%'
          : '建议打折';
    case 'remove':
      return '建议下架';
    default:
      return promo.action;
  }
}

/// 促销建议徽标：discount=橙色「建议打折 X%」，remove=红色「建议下架」。
class PromoBadge extends StatelessWidget {
  const PromoBadge({super.key, required this.promo});

  final ReminderPromo promo;

  @override
  Widget build(BuildContext context) {
    final color = promo.action == 'remove' ? Colors.red : Colors.orange;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        promoSummaryZh(promo),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

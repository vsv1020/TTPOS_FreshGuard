import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/main.dart';
import 'package:freshguard_store_flutter/notifications/reminder_notifications.dart';
import 'package:freshguard_store_flutter/promo.dart';
import 'package:freshguard_store_flutter/scanning/scan_handle.dart';

void main() {
  test('ReminderPromo.fromJson parses discount and remove actions', () {
    final discount = ReminderPromo.fromJson({
      'action': 'discount',
      'discountPercent': 30,
      'hoursBeforeExpiry': 24,
    });
    expect(discount, isNotNull);
    expect(discount!.action, 'discount');
    expect(discount.discountPercent, 30);
    expect(discount.hoursBeforeExpiry, 24);

    final remove = ReminderPromo.fromJson({'action': 'remove', 'hoursBeforeExpiry': 6});
    expect(remove!.action, 'remove');
    expect(remove.discountPercent, isNull);
  });

  test('ReminderPromo.fromJson returns null for legacy/absent data', () {
    expect(ReminderPromo.fromJson(null), isNull);
    expect(ReminderPromo.fromJson('x'), isNull);
    expect(ReminderPromo.fromJson(<String, dynamic>{}), isNull);
  });

  test('promoSummaryZh maps actions to Chinese suggestions', () {
    expect(
      promoSummaryZh(const ReminderPromo(action: 'discount', discountPercent: 20)),
      '建议打折 20%',
    );
    expect(promoSummaryZh(const ReminderPromo(action: 'discount')), '建议打折');
    expect(promoSummaryZh(const ReminderPromo(action: 'remove')), '建议下架');
    // Unknown future actions degrade to the raw value.
    expect(promoSummaryZh(const ReminderPromo(action: 'donate')), 'donate');
  });

  test('ReminderItem.fromJson parses promo and colorCode, tolerates legacy', () {
    final item = ReminderItem.fromJson({
      'id': 7,
      'productName': 'Salad',
      'expiresAt': '2026-06-11T00:00:00Z',
      'batchId': 3,
      'colorCode': 'green',
      'promo': {'action': 'discount', 'discountPercent': 50, 'hoursBeforeExpiry': 12},
    });
    expect(item.colorCode, 'green');
    expect(item.promo?.action, 'discount');
    expect(item.promo?.discountPercent, 50);

    final legacy = ReminderItem.fromJson({
      'id': 8,
      'productName': 'Soup',
      'expiresAt': '2026-06-12T00:00:00Z',
    });
    expect(legacy.colorCode, isNull);
    expect(legacy.promo, isNull);
  });

  test('ProductItem.fromJson parses optional colorCode', () {
    final item = ProductItem.fromJson({
      'id': 1,
      'name': 'Milk',
      'sku': 'M1',
      'shelfLifeDays': 3,
      'labelLanguage': 'zh',
      'colorCode': 'red',
    });
    expect(item.colorCode, 'red');

    final legacy = ProductItem.fromJson({
      'id': 2,
      'name': 'Bread',
      'sku': null,
      'shelfLifeDays': 2,
      'labelLanguage': 'zh',
    });
    expect(legacy.colorCode, isNull);
  });

  test('handlingReasonLabel shows 转促销售出 for discounted', () {
    expect(handlingReasonLabel('discounted'), '转促销售出');
    expect(handlingReasonLabel('sold'), 'Sold');
    expect(kHandlingReasons, contains('discounted'));
  });

  test('expiryNoticeBody appends promo suggestion when present', () {
    final expiresAt = DateTime.utc(2026, 6, 11, 8);
    final plain = ExpiryNotice(id: 1, title: 'Salad', expiresAt: expiresAt);
    expect(expiryNoticeBody(plain), isNot(contains('建议')));

    final withPromo = ExpiryNotice(
      id: 2,
      title: 'Salad',
      expiresAt: expiresAt,
      promoText: '建议打折 20%',
    );
    expect(expiryNoticeBody(withPromo), contains('建议打折 20%'));
  });
}

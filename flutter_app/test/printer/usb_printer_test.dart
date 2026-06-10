import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/printer/usb_printer.dart';

void main() {
  test('TSPL sample command contains setup, label text, and barcode', () {
    final command = utf8.decode(
      LabelCommandBuilder.buildSample(
        profile: PrinterProfile.tspl,
        labelText: 'Product: Salad\nBatch ID: 10',
        barcodeData: 'BATCH10',
      ),
    );

    expect(command, contains('SIZE 60 mm,40 mm'));
    expect(command, contains('TEXT 20,40'));
    expect(command, contains('Product: Salad'));
    expect(command, contains('BARCODE 20,220'));
    expect(command, contains('"BATCH10"'));
  });

  test('CPCL sample command contains setup, label text, and barcode', () {
    final command = utf8.decode(
      LabelCommandBuilder.buildSample(
        profile: PrinterProfile.cpcl,
        labelText: 'Product: Soup\nStore: FreshGuard',
        barcodeData: 'SOUP123',
      ),
    );

    expect(command, contains('! 0 200 200 340 1'));
    expect(command, contains('TEXT 0 0 20 36 "Product: Soup"'));
    expect(command, contains('BARCODE 128 1 1 80 20 220 "SOUP123"'));
    expect(command, contains('PRINT'));
  });

  test('printer profile parsing falls back to TSPL', () {
    expect(parsePrinterProfile('tspl'), PrinterProfile.tspl);
    expect(parsePrinterProfile('cpcl'), PrinterProfile.cpcl);
    expect(parsePrinterProfile('unknown'), PrinterProfile.tspl);
    expect(parsePrinterProfile(null), PrinterProfile.tspl);
  });

  // ── buildLabel tests ──────────────────────────────────────────────────────

  test('buildLabel TSPL contains product name, EXP date, barcode', () {
    final data = LabelData(
      productName: 'Organic Salad',
      storeName: 'FreshGuard HQ',
      printedAt: '2024-03-15T09:00:00Z',
      expiresAt: '2024-03-18T09:00:00Z',
      barcodeData: 'FG-1-1-5',
      allergens: 'Nuts',
      storageConditions: '2-4°C',
      opened: false,
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.tspl, data: data),
    );

    expect(command, contains('SIZE 60 mm,40 mm'));
    expect(command, contains('Organic Salad'));
    expect(command, contains('EXP:  2024-03-18'));
    expect(command, contains('ALLERGEN: Nuts'));
    expect(command, contains('STORE: 2-4°C'));
    // barcodeData sanitized: FG115
    expect(command, contains('"FG115"'));
    // human-readable original below barcode
    expect(command, contains('FG-1-1-5'));
    expect(command, isNot(contains('OPENED')));
  });

  test('buildLabel TSPL opened=true shows OPENED banner', () {
    final data = LabelData(
      productName: 'Soup',
      storeName: 'Store A',
      printedAt: '2024-03-15T00:00:00Z',
      expiresAt: '2024-03-16T00:00:00Z',
      barcodeData: 'FG-2-3-7',
      opened: true,
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.tspl, data: data),
    );

    expect(command, contains('OPENED'));
    expect(command, contains('已开封'));
  });

  test('buildLabel TSPL no allergens/storage when fields are null', () {
    final data = LabelData(
      productName: 'Plain Bread',
      storeName: 'Store B',
      printedAt: '2024-03-15T00:00:00Z',
      expiresAt: '2024-03-20T00:00:00Z',
      barcodeData: 'FG-3-1-2',
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.tspl, data: data),
    );

    expect(command, isNot(contains('ALLERGEN')));
    expect(command, isNot(contains('STORE:')));
  });

  test('buildLabel CPCL contains product name, EXP date, barcode', () {
    final data = LabelData(
      productName: 'Fresh Milk',
      storeName: 'Cold Storage',
      printedAt: '2024-04-01T08:00:00Z',
      expiresAt: '2024-04-05T08:00:00Z',
      barcodeData: 'FG-4-2-9',
      allergens: 'Dairy',
      storageConditions: '0-4°C',
      opened: false,
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.cpcl, data: data),
    );

    expect(command, contains('! 0 200 200'));
    expect(command, contains('Fresh Milk'));
    expect(command, contains('EXP:  2024-04-05'));
    expect(command, contains('ALLERGEN: Dairy'));
    expect(command, contains('STORE: 0-4°C'));
    expect(command, contains('"FG429"'));
    expect(command, contains('FG-4-2-9'));
    expect(command, isNot(contains('OPENED')));
  });

  test('buildLabel CPCL opened=true shows OPENED banner', () {
    final data = LabelData(
      productName: 'Juice',
      storeName: 'Store C',
      printedAt: '2024-04-01T00:00:00Z',
      expiresAt: '2024-04-02T00:00:00Z',
      barcodeData: 'FG-5-1-1',
      opened: true,
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.cpcl, data: data),
    );

    expect(command, contains('OPENED'));
    expect(command, contains('已开封'));
  });

  test('LabelData.fromBackend parses all fields correctly', () {
    final map = <String, dynamic>{
      'productName': 'Test Product',
      'storeName': 'Test Store',
      'printedAt': '2024-05-01T10:00:00Z',
      'expiresAt': '2024-05-08T10:00:00Z',
      'barcodeData': 'FG-1-2-3',
      'languages': ['en', 'zh'],
      'allergens': 'Gluten',
      'storageConditions': 'Room temp',
      'opened': true,
    };

    final label = LabelData.fromBackend(map);

    expect(label.productName, 'Test Product');
    expect(label.storeName, 'Test Store');
    expect(label.printedAt, '2024-05-01T10:00:00Z');
    expect(label.expiresAt, '2024-05-08T10:00:00Z');
    expect(label.barcodeData, 'FG-1-2-3');
    expect(label.languages, ['en', 'zh']);
    expect(label.allergens, 'Gluten');
    expect(label.storageConditions, 'Room temp');
    expect(label.opened, isTrue);
  });

  test('LabelData.fromBackend handles missing optional fields', () {
    final map = <String, dynamic>{
      'productName': 'Minimal',
      'storeName': 'Store',
      'printedAt': '2024-06-01T00:00:00Z',
      'expiresAt': '2024-06-07T00:00:00Z',
      'barcodeData': 'FG-0-0-1',
    };

    final label = LabelData.fromBackend(map);

    expect(label.allergens, isNull);
    expect(label.storageConditions, isNull);
    expect(label.languages, isNull);
    expect(label.opened, isFalse);
  });

  // ── Color-code marker tests ───────────────────────────────────────────────

  test('buildLabel TSPL prints color marker text when colorLabel is set', () {
    final data = LabelData(
      productName: 'Beef',
      storeName: 'Store A',
      printedAt: '2026-06-10T00:00:00Z',
      expiresAt: '2026-06-12T00:00:00Z',
      barcodeData: 'FG-9-1-1',
      colorCode: 'red',
      colorLabel: '红·畜肉禽类',
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.tspl, data: data),
    );

    expect(command, contains('【红·畜肉禽类】'));
  });

  test('buildLabel CPCL falls back to colorCode mapping without colorLabel', () {
    final data = LabelData(
      productName: 'Fish',
      storeName: 'Store B',
      printedAt: '2026-06-10T00:00:00Z',
      expiresAt: '2026-06-11T00:00:00Z',
      barcodeData: 'FG-9-2-2',
      colorCode: 'blue',
    );

    final command = utf8.decode(
      LabelCommandBuilder.buildLabel(profile: PrinterProfile.cpcl, data: data),
    );

    expect(command, contains('【蓝·水产】'));
  });

  test('buildLabel omits color marker for legacy data without color fields', () {
    final data = LabelData(
      productName: 'Plain',
      storeName: 'Store C',
      printedAt: '2026-06-10T00:00:00Z',
      expiresAt: '2026-06-11T00:00:00Z',
      barcodeData: 'FG-9-3-3',
    );

    for (final profile in PrinterProfile.values) {
      final command = utf8.decode(
        LabelCommandBuilder.buildLabel(profile: profile, data: data),
      );
      expect(command, isNot(contains('【')));
    }
  });

  test('LabelData.fromBackend parses colorCode and colorLabel', () {
    final label = LabelData.fromBackend(<String, dynamic>{
      'productName': 'Beef',
      'storeName': 'Store',
      'printedAt': '2026-06-10T00:00:00Z',
      'expiresAt': '2026-06-12T00:00:00Z',
      'barcodeData': 'FG-9-4-4',
      'colorCode': 'red',
      'colorLabel': '红·畜肉禽类',
    });

    expect(label.colorCode, 'red');
    expect(label.colorLabel, '红·畜肉禽类');

    final legacy = LabelData.fromBackend(<String, dynamic>{
      'productName': 'Old',
      'storeName': 'Store',
      'printedAt': '2026-06-10T00:00:00Z',
      'expiresAt': '2026-06-12T00:00:00Z',
      'barcodeData': 'FG-9-5-5',
    });

    expect(legacy.colorCode, isNull);
    expect(legacy.colorLabel, isNull);
  });

  // ── Existing serialization test ───────────────────────────────────────────

  test('USB device key and settings serialization are stable', () {
    const device = UsbPrinterDevice(
      deviceId: 3,
      vendorId: 4660,
      productId: 22136,
      deviceName: '/dev/bus/usb/001/003',
      productName: 'Label Printer',
      manufacturerName: 'Printer Co',
    );
    expect(device.persistentKey, '4660:22136:3');
    expect(device.vendorHex, '0x1234');
    expect(device.productHex, '0x5678');

    const settings = UsbPrinterSettings(
      profile: PrinterProfile.cpcl,
      device: device,
    );
    final parsed = UsbPrinterSettings.fromJson(settings.toJson());

    expect(parsed.profile, PrinterProfile.cpcl);
    expect(parsed.device?.vendorId, 4660);
    expect(parsed.device?.productId, 22136);
  });
}

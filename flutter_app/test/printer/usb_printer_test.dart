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

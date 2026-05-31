import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';

const _usbPrinterChannelName = 'freshguard/usb_printer';

enum PrinterProfile { tspl, cpcl }

PrinterProfile parsePrinterProfile(String? raw) {
  switch (raw?.trim().toLowerCase()) {
    case 'cpcl':
      return PrinterProfile.cpcl;
    case 'tspl':
    default:
      return PrinterProfile.tspl;
  }
}

extension PrinterProfileX on PrinterProfile {
  String get wireValue {
    switch (this) {
      case PrinterProfile.tspl:
        return 'tspl';
      case PrinterProfile.cpcl:
        return 'cpcl';
    }
  }

  String get label {
    switch (this) {
      case PrinterProfile.tspl:
        return 'TSPL';
      case PrinterProfile.cpcl:
        return 'CPCL';
    }
  }
}

class UsbPrinterDevice {
  const UsbPrinterDevice({
    required this.deviceId,
    required this.vendorId,
    required this.productId,
    required this.deviceName,
    this.productName,
    this.manufacturerName,
  });

  final int deviceId;
  final int vendorId;
  final int productId;
  final String deviceName;
  final String? productName;
  final String? manufacturerName;

  String get persistentKey => '$vendorId:$productId:$deviceId';
  String get vendorHex => _hex4(vendorId);
  String get productHex => _hex4(productId);

  String get title {
    if (productName != null && productName!.trim().isNotEmpty) {
      return productName!.trim();
    }
    if (manufacturerName != null && manufacturerName!.trim().isNotEmpty) {
      return manufacturerName!.trim();
    }
    return 'USB Device $deviceId';
  }

  String get subtitle => 'VID $vendorHex / PID $productHex';

  Map<String, dynamic> toJson() {
    return {
      'deviceId': deviceId,
      'vendorId': vendorId,
      'productId': productId,
      'deviceName': deviceName,
      'productName': productName,
      'manufacturerName': manufacturerName,
    };
  }

  factory UsbPrinterDevice.fromJson(Map<String, dynamic> json) {
    final deviceId = (json['deviceId'] as num?)?.toInt();
    final vendorId = (json['vendorId'] as num?)?.toInt();
    final productId = (json['productId'] as num?)?.toInt();
    final deviceName = json['deviceName']?.toString();

    if (deviceId == null || vendorId == null || productId == null || deviceName == null) {
      throw const FormatException('Invalid USB printer device payload.');
    }

    return UsbPrinterDevice(
      deviceId: deviceId,
      vendorId: vendorId,
      productId: productId,
      deviceName: deviceName,
      productName: json['productName']?.toString(),
      manufacturerName: json['manufacturerName']?.toString(),
    );
  }
}

class UsbPrinterSettings {
  const UsbPrinterSettings({
    required this.profile,
    this.device,
  });

  final PrinterProfile profile;
  final UsbPrinterDevice? device;

  Map<String, dynamic> toJson() {
    return {
      'profile': profile.wireValue,
      'device': device?.toJson(),
    };
  }

  factory UsbPrinterSettings.fromJson(Map<String, dynamic> json) {
    final profile = parsePrinterProfile(json['profile']?.toString());
    final rawDevice = json['device'];

    UsbPrinterDevice? device;
    if (rawDevice is Map) {
      device = UsbPrinterDevice.fromJson(Map<String, dynamic>.from(rawDevice));
    }

    return UsbPrinterSettings(
      profile: profile,
      device: device,
    );
  }
}

class UsbPrinterService {
  const UsbPrinterService({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel(_usbPrinterChannelName);

  final MethodChannel _channel;

  Future<List<UsbPrinterDevice>> listDevices() async {
    final result = await _channel.invokeListMethod<dynamic>('listDevices');
    if (result == null) {
      return [];
    }

    return result.map((raw) {
      final map = Map<String, dynamic>.from((raw as Map).cast<String, dynamic>());
      return UsbPrinterDevice.fromJson(map);
    }).toList();
  }

  Future<bool> requestPermission({required int deviceId}) async {
    final granted = await _channel.invokeMethod<bool>('requestPermission', {'deviceId': deviceId});
    return granted ?? false;
  }

  Future<int> write({
    required int deviceId,
    required Uint8List bytes,
    int timeoutMs = 4000,
  }) async {
    final written = await _channel.invokeMethod<int>('write', {
      'deviceId': deviceId,
      'bytes': bytes,
      'timeoutMs': timeoutMs,
    });
    return written ?? 0;
  }
}

class LabelData {
  const LabelData({
    required this.productName,
    required this.storeName,
    required this.printedAt,
    required this.expiresAt,
    required this.barcodeData,
    this.languages,
    this.allergens,
    this.storageConditions,
    this.opened = false,
    this.templateBody,
    this.fields,
  });

  final String productName;
  final String storeName;
  final String printedAt;
  final String expiresAt;
  final String barcodeData;
  final List<String>? languages;
  final String? allergens;
  final String? storageConditions;
  final bool opened;
  /// Raw template body from the backend (used by admin preview; Flutter
  /// continues to use structured TSPL/CPCL layout via [buildLabel]).
  final String? templateBody;
  /// Structured fields map returned by the backend alongside templateBody.
  final Map<String, dynamic>? fields;

  factory LabelData.fromBackend(Map<String, dynamic> label) {
    final rawLangs = label['languages'];
    List<String>? languages;
    if (rawLangs is List) {
      languages = rawLangs.map((e) => e.toString()).toList();
    }

    Map<String, dynamic>? fields;
    final rawFields = label['fields'];
    if (rawFields is Map) {
      fields = Map<String, dynamic>.from(rawFields);
    }

    return LabelData(
      productName: label['productName']?.toString() ?? '',
      storeName: label['storeName']?.toString() ?? '',
      printedAt: label['printedAt']?.toString() ?? '',
      expiresAt: label['expiresAt']?.toString() ?? '',
      barcodeData: label['barcodeData']?.toString() ?? '',
      languages: languages,
      allergens: label['allergens']?.toString(),
      storageConditions: label['storageConditions']?.toString(),
      opened: label['opened'] == true,
      templateBody: label['templateBody']?.toString(),
      fields: fields,
    );
  }
}

class LabelCommandBuilder {
  static Uint8List buildLabel({
    required PrinterProfile profile,
    required LabelData data,
  }) {
    final command = switch (profile) {
      PrinterProfile.tspl => _buildStructuredTspl(data),
      PrinterProfile.cpcl => _buildStructuredCpcl(data),
    };
    return Uint8List.fromList(utf8.encode(command));
  }

  static Uint8List buildSample({
    required PrinterProfile profile,
    required String labelText,
    String barcodeData = '123456789012',
  }) {
    final command = switch (profile) {
      PrinterProfile.tspl => _buildTspl(labelText: labelText, barcodeData: barcodeData),
      PrinterProfile.cpcl => _buildCpcl(labelText: labelText, barcodeData: barcodeData),
    };

    return Uint8List.fromList(utf8.encode(command));
  }

  // ── Structured label builders (60×40 mm, ~472×320 dots @200dpi) ──────────

  static String _buildStructuredTspl(LabelData data) {
    final barcode = _sanitizeBarcode(data.barcodeData);
    final prodDate = _dateOnly(data.printedAt);
    final expDate = _dateOnly(data.expiresAt);

    final buffer = StringBuffer()
      ..writeln('SIZE 60 mm,40 mm')
      ..writeln('GAP 2 mm,0 mm')
      ..writeln('DIRECTION 1')
      ..writeln('REFERENCE 0,0')
      ..writeln('CLS');

    var y = 8;

    // Opened banner
    if (data.opened) {
      buffer.writeln('TEXT 20,$y,"2",0,1,1,"** OPENED / 已开封 **"');
      y += 30;
    }

    // Product name – larger font (font "3", scale 2×2)
    final name = _truncate(data.productName, 22);
    buffer.writeln('TEXT 20,$y,"3",0,2,2,"${_escapeQuoted(name)}"');
    y += 44;

    // Store name – small
    final store = _truncate(data.storeName, 30);
    buffer.writeln('TEXT 20,$y,"0",0,1,1,"${_escapeQuoted(store)}"');
    y += 24;

    // PROD date
    buffer.writeln('TEXT 20,$y,"0",0,1,1,"PROD: $prodDate"');
    y += 22;

    // EXP date – bold via font "2", scale 1×2 for height emphasis
    buffer.writeln('TEXT 20,$y,"2",0,1,2,"EXP:  $expDate"');
    y += 32;

    // Allergens (optional)
    if (data.allergens != null && data.allergens!.isNotEmpty) {
      final al = _truncate('ALLERGEN: ${data.allergens!}', 36);
      buffer.writeln('TEXT 20,$y,"0",0,1,1,"${_escapeQuoted(al)}"');
      y += 22;
    }

    // Storage conditions (optional)
    if (data.storageConditions != null && data.storageConditions!.isNotEmpty) {
      final sc = _truncate('STORE: ${data.storageConditions!}', 36);
      buffer.writeln('TEXT 20,$y,"0",0,1,1,"${_escapeQuoted(sc)}"');
      y += 22;
    }

    // Barcode + human-readable text at bottom
    final barcodeY = 232;
    buffer
      ..writeln('BARCODE 20,$barcodeY,"128",60,1,0,2,2,"$barcode"')
      ..writeln('TEXT 20,${barcodeY + 64},"0",0,1,1,"${_escapeQuoted(data.barcodeData)}"')
      ..writeln('PRINT 1,1');

    return buffer.toString();
  }

  static String _buildStructuredCpcl(LabelData data) {
    final barcode = _sanitizeBarcode(data.barcodeData);
    final prodDate = _dateOnly(data.printedAt);
    final expDate = _dateOnly(data.expiresAt);

    final buffer = StringBuffer()
      ..writeln('! 0 200 200 340 1')
      ..writeln('LEFT');

    var y = 10;

    // Opened banner
    if (data.opened) {
      buffer.writeln('TEXT 0 3 10 $y "** OPENED / 已开封 **"');
      y += 28;
    }

    // Product name – larger font (font 4 = larger in CPCL)
    final name = _truncate(data.productName, 22);
    buffer.writeln('TEXT 0 4 10 $y "${_escapeQuoted(name)}"');
    y += 36;

    // Store name
    final store = _truncate(data.storeName, 30);
    buffer.writeln('TEXT 0 0 10 $y "${_escapeQuoted(store)}"');
    y += 22;

    // PROD date
    buffer.writeln('TEXT 0 0 10 $y "PROD: $prodDate"');
    y += 20;

    // EXP date – font 3 for emphasis
    buffer.writeln('TEXT 0 3 10 $y "EXP:  $expDate"');
    y += 28;

    // Allergens (optional)
    if (data.allergens != null && data.allergens!.isNotEmpty) {
      final al = _truncate('ALLERGEN: ${data.allergens!}', 36);
      buffer.writeln('TEXT 0 0 10 $y "${_escapeQuoted(al)}"');
      y += 20;
    }

    // Storage conditions (optional)
    if (data.storageConditions != null && data.storageConditions!.isNotEmpty) {
      final sc = _truncate('STORE: ${data.storageConditions!}', 36);
      buffer.writeln('TEXT 0 0 10 $y "${_escapeQuoted(sc)}"');
      y += 20;
    }

    // Barcode + human-readable text at bottom
    buffer
      ..writeln('BARCODE 128 1 1 60 10 240 "$barcode"')
      ..writeln('TEXT 0 0 10 305 "${_escapeQuoted(data.barcodeData)}"')
      ..writeln('FORM')
      ..writeln('PRINT');

    return buffer.toString();
  }

  // ── Legacy text-dump builders (kept for buildSample) ─────────────────────

  static String _buildTspl({required String labelText, required String barcodeData}) {
    final lines = _normalizeLines(labelText);
    final buffer = StringBuffer()
      ..writeln('SIZE 60 mm,40 mm')
      ..writeln('GAP 2 mm,0 mm')
      ..writeln('DIRECTION 1')
      ..writeln('REFERENCE 0,0')
      ..writeln('CLS');

    var y = 40;
    for (final line in lines.take(4)) {
      buffer.writeln('TEXT 20,$y,"0",0,1,1,"${_escapeQuoted(line)}"');
      y += 32;
    }

    buffer
      ..writeln('BARCODE 20,220,"128",70,1,0,2,2,"${_sanitizeBarcode(barcodeData)}"')
      ..writeln('PRINT 1,1');

    return buffer.toString();
  }

  static String _buildCpcl({required String labelText, required String barcodeData}) {
    final lines = _normalizeLines(labelText);
    final buffer = StringBuffer()
      ..writeln('! 0 200 200 340 1')
      ..writeln('LEFT');

    var y = 36;
    for (final line in lines.take(5)) {
      buffer.writeln('TEXT 0 0 20 $y "${_escapeQuoted(line)}"');
      y += 28;
    }

    buffer
      ..writeln('BARCODE 128 1 1 80 20 220 "${_sanitizeBarcode(barcodeData)}"')
      ..writeln('FORM')
      ..writeln('PRINT');

    return buffer.toString();
  }

  static List<String> _normalizeLines(String labelText) {
    final lines = labelText
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    if (lines.isEmpty) {
      return const ['FreshGuard Sample Label'];
    }
    return lines;
  }

  static String _escapeQuoted(String value) {
    return value.replaceAll('"', "'");
  }

  static String _sanitizeBarcode(String barcodeData) {
    final sanitized = barcodeData.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
    if (sanitized.isEmpty) {
      return '000000';
    }
    return sanitized;
  }

  /// Returns just the YYYY-MM-DD portion of an ISO date string.
  static String _dateOnly(String isoDate) {
    if (isoDate.length >= 10) return isoDate.substring(0, 10);
    return isoDate;
  }

  /// Truncates [text] to [maxChars] characters to avoid label overflow.
  static String _truncate(String text, int maxChars) {
    if (text.length <= maxChars) return text;
    return '${text.substring(0, maxChars - 1)}~';
  }
}

String _hex4(int value) {
  return '0x${value.toRadixString(16).padLeft(4, '0').toUpperCase()}';
}

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

class LabelCommandBuilder {
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
}

String _hex4(int value) {
  return '0x${value.toRadixString(16).padLeft(4, '0').toUpperCase()}';
}

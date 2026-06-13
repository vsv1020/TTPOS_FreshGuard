import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import 'transport.dart';

/// Bluetooth Low Energy transport via `flutter_blue_plus`. Works on both iOS
/// (Core Bluetooth) and Android with no per-platform Dart code.
///
/// Label printers expose a writable characteristic that accepts raw TSPL/CPCL
/// bytes; this transport scans for devices, connects, finds the first writable
/// characteristic, and streams each page in MTU-sized chunks.
///
/// NOTE: requires real hardware to validate end-to-end (no BLE in unit tests).
class BleTransport implements PrinterTransport {
  BleTransport({Duration scanTimeout = const Duration(seconds: 6)})
    : _scanTimeout = scanTimeout;

  final Duration _scanTimeout;

  @override
  PrinterTransportType get type => PrinterTransportType.bluetoothLe;

  // BLE is supported on both iOS and Android; the OS-level adapter/permission
  // checks happen at scan time.
  @override
  bool get isAvailable => true;

  @override
  Future<List<PrinterEndpoint>> discover() async {
    final found = <String, PrinterEndpoint>{};

    final sub = FlutterBluePlus.onScanResults.listen((results) {
      for (final r in results) {
        final id = r.device.remoteId.str;
        final advName = r.advertisementData.advName;
        final name = advName.isNotEmpty
            ? advName
            : (r.device.platformName.isNotEmpty ? r.device.platformName : 'BLE Printer');
        found[id] = PrinterEndpoint(
          transport: PrinterTransportType.bluetoothLe,
          id: id,
          name: name,
          detail: 'RSSI ${r.rssi} · $id',
          data: {'remoteId': id},
        );
      }
    });

    try {
      await FlutterBluePlus.startScan(timeout: _scanTimeout);
      // startScan returns immediately; wait out the scan window then stop.
      await Future<void>.delayed(_scanTimeout);
      await FlutterBluePlus.stopScan();
    } finally {
      await sub.cancel();
    }

    return found.values.toList();
  }

  @override
  Future<void> send(
    PrinterEndpoint endpoint,
    List<Uint8List> pages, {
    int timeoutMs = 4000,
  }) async {
    final remoteId = endpoint.data['remoteId']?.toString() ?? endpoint.id;
    if (remoteId.isEmpty) {
      throw Exception('BLE endpoint has no remoteId.');
    }

    final device = BluetoothDevice.fromId(remoteId);
    try {
      await device.connect(timeout: Duration(milliseconds: timeoutMs));

      // Larger MTU = fewer round-trips. Best-effort; falls back to the
      // negotiated default when the platform/printer refuses.
      var chunkSize = 20;
      try {
        final mtu = await device.requestMtu(512);
        if (mtu > 3) {
          chunkSize = mtu - 3;
        }
      } catch (_) {
        // Keep the conservative default chunk size.
      }

      final characteristic = await _findWritableCharacteristic(device);
      if (characteristic == null) {
        throw Exception('No writable BLE characteristic found on the printer.');
      }
      final withoutResponse = characteristic.properties.writeWithoutResponse;

      for (final page in pages) {
        for (var offset = 0; offset < page.length; offset += chunkSize) {
          final end = (offset + chunkSize < page.length) ? offset + chunkSize : page.length;
          await characteristic.write(
            page.sublist(offset, end),
            withoutResponse: withoutResponse,
          );
        }
      }
    } finally {
      await device.disconnect();
    }
  }

  Future<BluetoothCharacteristic?> _findWritableCharacteristic(
    BluetoothDevice device,
  ) async {
    final services = await device.discoverServices();
    for (final service in services) {
      for (final c in service.characteristics) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          return c;
        }
      }
    }
    return null;
  }
}

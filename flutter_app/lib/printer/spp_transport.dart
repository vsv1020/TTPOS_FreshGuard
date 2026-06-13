import 'dart:io';

import 'package:flutter/services.dart';

import 'transport.dart';

const _sppChannelName = 'freshguard/bluetooth_spp';

/// Classic Bluetooth SPP (RFCOMM) transport. Android-only: iOS gates classic
/// SPP behind MFi certification, so [isAvailable] is false there and the
/// transport is filtered out of the picker.
///
/// Discovery returns the system's *bonded* (paired) devices — SPP printers are
/// paired in Android Settings first, then selected here. The native side opens
/// an RFCOMM socket to the well-known SPP UUID, writes, and closes.
///
/// NOTE: requires real hardware to validate end-to-end (no SPP in unit tests).
class SppTransport implements PrinterTransport {
  SppTransport({MethodChannel? channel, bool? available})
    : _channel = channel ?? const MethodChannel(_sppChannelName),
      _available = available ?? Platform.isAndroid;

  final MethodChannel _channel;
  final bool _available;

  @override
  PrinterTransportType get type => PrinterTransportType.bluetoothSpp;

  @override
  bool get isAvailable => _available;

  @override
  Future<List<PrinterEndpoint>> discover() async {
    final result = await _channel.invokeListMethod<dynamic>('listBondedDevices');
    if (result == null) {
      return [];
    }
    return result.map((raw) {
      final map = Map<String, dynamic>.from((raw as Map).cast<String, dynamic>());
      final address = map['address']?.toString() ?? '';
      final name = (map['name']?.toString().isNotEmpty ?? false)
          ? map['name'].toString()
          : 'SPP Printer';
      return PrinterEndpoint(
        transport: PrinterTransportType.bluetoothSpp,
        id: address,
        name: name,
        detail: 'SPP · $address',
        data: {'address': address},
      );
    }).toList();
  }

  @override
  Future<void> send(
    PrinterEndpoint endpoint,
    List<Uint8List> pages, {
    int timeoutMs = 4000,
  }) async {
    final address = endpoint.data['address']?.toString() ?? endpoint.id;
    if (address.isEmpty) {
      throw Exception('SPP endpoint has no device address.');
    }

    // Concatenate pages into a single RFCOMM write so the socket is opened once.
    final total = pages.fold<int>(0, (sum, p) => sum + p.length);
    final payload = Uint8List(total);
    var cursor = 0;
    for (final page in pages) {
      payload.setRange(cursor, cursor + page.length, page);
      cursor += page.length;
    }

    final written = await _channel.invokeMethod<int>('write', {
      'address': address,
      'bytes': payload,
      'timeoutMs': timeoutMs,
    });
    if (written == null || written <= 0) {
      throw Exception('SPP write failed (wrote ${written ?? 0} bytes).');
    }
  }
}

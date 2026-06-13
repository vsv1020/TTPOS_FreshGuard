import 'dart:io';
import 'dart:typed_data';

import 'transport.dart';
import 'usb_printer.dart';

/// Android-only transport that wraps the existing [UsbPrinterService] native
/// channel. iOS has no generic USB host access, so [isAvailable] is false there
/// and the transport is filtered out of the picker.
class UsbTransport implements PrinterTransport {
  UsbTransport({UsbPrinterService? service, bool? available})
    : _service = service ?? const UsbPrinterService(),
      _available = available ?? Platform.isAndroid;

  final UsbPrinterService _service;
  final bool _available;

  @override
  PrinterTransportType get type => PrinterTransportType.usb;

  @override
  bool get isAvailable => _available;

  @override
  Future<List<PrinterEndpoint>> discover() async {
    final devices = await _service.listDevices();
    return devices.map(endpointFor).toList();
  }

  /// Builds a normalized endpoint from a USB device, preserving every field
  /// needed to reconnect later via [_deviceFromEndpoint].
  static PrinterEndpoint endpointFor(UsbPrinterDevice device) {
    return PrinterEndpoint(
      transport: PrinterTransportType.usb,
      id: device.persistentKey,
      name: device.title,
      detail: '${device.subtitle} | Device ID ${device.deviceId}',
      data: device.toJson(),
    );
  }

  static UsbPrinterDevice _deviceFromEndpoint(PrinterEndpoint endpoint) {
    return UsbPrinterDevice.fromJson(Map<String, dynamic>.from(endpoint.data));
  }

  @override
  Future<void> send(
    PrinterEndpoint endpoint,
    List<Uint8List> pages, {
    int timeoutMs = 4000,
  }) async {
    final device = _deviceFromEndpoint(endpoint);
    final granted = await _service.requestPermission(deviceId: device.deviceId);
    if (!granted) {
      throw Exception('USB permission denied for selected printer.');
    }
    for (final bytes in pages) {
      final written = await _service.write(
        deviceId: device.deviceId,
        bytes: bytes,
        timeoutMs: timeoutMs,
      );
      if (written <= 0) {
        throw Exception('USB write failed (wrote $written bytes).');
      }
    }
  }
}

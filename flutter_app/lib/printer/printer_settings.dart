import 'transport.dart';
import 'usb_printer.dart';

/// Locally persisted printer configuration: which command profile, which
/// transport, and the selected endpoint on that transport.
///
/// Supersedes the old USB-only `UsbPrinterSettings`. [fromJson] transparently
/// migrates that legacy shape (`{profile, device}`) so existing installs keep
/// their saved USB printer.
class PrinterSettings {
  const PrinterSettings({
    required this.profile,
    this.transport = PrinterTransportType.usb,
    this.endpoint,
  });

  final PrinterProfile profile;
  final PrinterTransportType transport;
  final PrinterEndpoint? endpoint;

  PrinterSettings copyWith({
    PrinterProfile? profile,
    PrinterTransportType? transport,
    PrinterEndpoint? endpoint,
    bool clearEndpoint = false,
  }) {
    return PrinterSettings(
      profile: profile ?? this.profile,
      transport: transport ?? this.transport,
      endpoint: clearEndpoint ? null : (endpoint ?? this.endpoint),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'profile': profile.wireValue,
      'transport': transport.wireValue,
      'endpoint': endpoint?.toJson(),
    };
  }

  factory PrinterSettings.fromJson(Map<String, dynamic> json) {
    final profile = parsePrinterProfile(json['profile']?.toString());

    // Legacy migration: old USB-only settings had a top-level `device` and no
    // `transport`. Treat them as a USB endpoint.
    if (json['transport'] == null && json['device'] is Map) {
      final device = UsbPrinterDevice.fromJson(
        Map<String, dynamic>.from(json['device'] as Map),
      );
      return PrinterSettings(
        profile: profile,
        transport: PrinterTransportType.usb,
        endpoint: UsbEndpointBridge.fromDevice(device),
      );
    }

    final rawEndpoint = json['endpoint'];
    PrinterEndpoint? endpoint;
    if (rawEndpoint is Map) {
      try {
        endpoint = PrinterEndpoint.fromJson(Map<String, dynamic>.from(rawEndpoint));
      } catch (_) {
        endpoint = null;
      }
    }

    return PrinterSettings(
      profile: profile,
      transport: parsePrinterTransportType(json['transport']?.toString()),
      endpoint: endpoint,
    );
  }
}

/// Bridges a legacy [UsbPrinterDevice] into the unified [PrinterEndpoint] shape
/// without importing the USB transport (keeps this model dependency-light).
class UsbEndpointBridge {
  static PrinterEndpoint fromDevice(UsbPrinterDevice device) {
    return PrinterEndpoint(
      transport: PrinterTransportType.usb,
      id: device.persistentKey,
      name: device.title,
      detail: '${device.subtitle} | Device ID ${device.deviceId}',
      data: device.toJson(),
    );
  }
}

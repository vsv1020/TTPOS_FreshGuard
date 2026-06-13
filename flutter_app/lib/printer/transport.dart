import 'dart:typed_data';

/// The physical channel a printer is reached over. USB and classic Bluetooth
/// SPP are Android-only (iOS lacks generic USB host access and gates SPP behind
/// MFi certification); BLE and network work on both platforms.
enum PrinterTransportType { usb, bluetoothLe, bluetoothSpp, network }

PrinterTransportType parsePrinterTransportType(String? raw) {
  switch (raw?.trim().toLowerCase()) {
    case 'ble':
    case 'bluetoothle':
      return PrinterTransportType.bluetoothLe;
    case 'spp':
    case 'bluetoothspp':
      return PrinterTransportType.bluetoothSpp;
    case 'network':
    case 'tcp':
      return PrinterTransportType.network;
    case 'usb':
    default:
      return PrinterTransportType.usb;
  }
}

extension PrinterTransportTypeX on PrinterTransportType {
  String get wireValue {
    switch (this) {
      case PrinterTransportType.usb:
        return 'usb';
      case PrinterTransportType.bluetoothLe:
        return 'ble';
      case PrinterTransportType.bluetoothSpp:
        return 'spp';
      case PrinterTransportType.network:
        return 'network';
    }
  }

  String get label {
    switch (this) {
      case PrinterTransportType.usb:
        return 'USB';
      case PrinterTransportType.bluetoothLe:
        return 'Bluetooth LE';
      case PrinterTransportType.bluetoothSpp:
        return 'Bluetooth (SPP)';
      case PrinterTransportType.network:
        return 'Network';
    }
  }

  /// Transports that discover devices by scanning. Network is configured by
  /// manual host/port entry instead, so it returns false here.
  bool get supportsDiscovery => this != PrinterTransportType.network;
}

/// Policy: which transports a given mobile OS can use at all. Kept as a pure
/// function (independent of `dart:io Platform`) so it is directly unit-testable;
/// the concrete transports delegate their `isAvailable` to this.
///
/// [os] is 'android' or 'ios' (case-insensitive); anything else is treated as a
/// desktop/test host where only the no-native-dependency network transport is
/// assumed available.
List<PrinterTransportType> supportedTransportsFor(String os) {
  switch (os.trim().toLowerCase()) {
    case 'android':
      return const [
        PrinterTransportType.usb,
        PrinterTransportType.bluetoothLe,
        PrinterTransportType.bluetoothSpp,
        PrinterTransportType.network,
      ];
    case 'ios':
      return const [
        PrinterTransportType.bluetoothLe,
        PrinterTransportType.network,
      ];
    default:
      return const [PrinterTransportType.network];
  }
}

/// A discovered (or manually configured) printer, normalized across transports.
/// [data] carries transport-specific fields needed to reconnect (e.g. USB
/// vendor/product ids, a BLE remoteId, or a network host/port).
class PrinterEndpoint {
  const PrinterEndpoint({
    required this.transport,
    required this.id,
    required this.name,
    required this.detail,
    this.data = const {},
  });

  final PrinterTransportType transport;

  /// Stable identity within a transport (USB persistent key, MAC/remoteId,
  /// or "host:port"). Used as the selection group value and for re-matching a
  /// saved endpoint against a fresh discovery scan.
  final String id;

  /// Human-readable title shown in the picker.
  final String name;

  /// Secondary line shown under the title.
  final String detail;

  final Map<String, dynamic> data;

  Map<String, dynamic> toJson() {
    return {
      'transport': transport.wireValue,
      'id': id,
      'name': name,
      'detail': detail,
      'data': data,
    };
  }

  factory PrinterEndpoint.fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) {
      throw const FormatException('Invalid printer endpoint payload: missing id.');
    }
    final rawData = json['data'];
    return PrinterEndpoint(
      transport: parsePrinterTransportType(json['transport']?.toString()),
      id: id,
      name: json['name']?.toString() ?? id,
      detail: json['detail']?.toString() ?? '',
      data: rawData is Map ? Map<String, dynamic>.from(rawData) : const {},
    );
  }
}

/// One physical way to reach a printer. Implementations own their own
/// connection lifecycle inside [send] so callers stay transport-agnostic.
abstract class PrinterTransport {
  PrinterTransportType get type;

  /// Whether this transport can run on the current platform.
  bool get isAvailable;

  /// Discover reachable endpoints. Returns an empty list for transports that
  /// are configured manually (network) rather than scanned.
  Future<List<PrinterEndpoint>> discover();

  /// Sends each page's bytes to [endpoint]. Throws on any failure (permission
  /// denied, connect timeout, short write). Connection setup/teardown is
  /// internal to the implementation.
  Future<void> send(
    PrinterEndpoint endpoint,
    List<Uint8List> pages, {
    int timeoutMs = 4000,
  });
}

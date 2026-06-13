import 'dart:io';
import 'dart:typed_data';

import 'transport.dart';

/// Default raw-printing TCP port (RAW / JetDirect), used by virtually all
/// network-capable label printers.
const int kDefaultPrinterPort = 9100;

/// Pure-Dart TCP transport — works identically on iOS and Android with no
/// native code. The printer is configured by host/port (no scanning), so
/// [discover] returns an empty list.
class NetworkTransport implements PrinterTransport {
  const NetworkTransport();

  @override
  PrinterTransportType get type => PrinterTransportType.network;

  @override
  bool get isAvailable => true;

  @override
  Future<List<PrinterEndpoint>> discover() async => const [];

  /// Builds an endpoint from a manually entered host/port.
  static PrinterEndpoint endpointFor(String host, {int port = kDefaultPrinterPort}) {
    final trimmed = host.trim();
    return PrinterEndpoint(
      transport: PrinterTransportType.network,
      id: '$trimmed:$port',
      name: trimmed,
      detail: 'TCP $trimmed:$port',
      data: {'host': trimmed, 'port': port},
    );
  }

  @override
  Future<void> send(
    PrinterEndpoint endpoint,
    List<Uint8List> pages, {
    int timeoutMs = 4000,
  }) async {
    final host = endpoint.data['host']?.toString() ?? '';
    final port = (endpoint.data['port'] as num?)?.toInt() ?? kDefaultPrinterPort;
    if (host.isEmpty) {
      throw Exception('Network printer host is empty.');
    }

    Socket? socket;
    try {
      socket = await Socket.connect(
        host,
        port,
        timeout: Duration(milliseconds: timeoutMs),
      );
      for (final bytes in pages) {
        socket.add(bytes);
      }
      await socket.flush();
    } on SocketException catch (e) {
      throw Exception('Network print failed: ${e.message}');
    } finally {
      await socket?.close();
      socket?.destroy();
    }
  }
}

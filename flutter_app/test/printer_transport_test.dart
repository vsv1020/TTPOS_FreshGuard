import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/printer/transport.dart';
import 'package:freshguard_store_flutter/printer/network_transport.dart';
import 'package:freshguard_store_flutter/printer/printer_settings.dart';
import 'package:freshguard_store_flutter/printer/usb_printer.dart';

void main() {
  group('supportedTransportsFor', () {
    test('Android exposes USB, BLE, SPP, network', () {
      expect(supportedTransportsFor('android'), [
        PrinterTransportType.usb,
        PrinterTransportType.bluetoothLe,
        PrinterTransportType.bluetoothSpp,
        PrinterTransportType.network,
      ]);
    });

    test('iOS exposes only BLE and network (no USB, no SPP)', () {
      final ios = supportedTransportsFor('iOS');
      expect(ios, [PrinterTransportType.bluetoothLe, PrinterTransportType.network]);
      expect(ios, isNot(contains(PrinterTransportType.usb)));
      expect(ios, isNot(contains(PrinterTransportType.bluetoothSpp)));
    });

    test('unknown host falls back to network only', () {
      expect(supportedTransportsFor('linux'), [PrinterTransportType.network]);
    });
  });

  group('PrinterTransportType parsing/labels', () {
    test('round-trips through wireValue', () {
      for (final t in PrinterTransportType.values) {
        expect(parsePrinterTransportType(t.wireValue), t);
      }
    });

    test('only network is manual (no discovery)', () {
      expect(PrinterTransportType.network.supportsDiscovery, isFalse);
      expect(PrinterTransportType.usb.supportsDiscovery, isTrue);
      expect(PrinterTransportType.bluetoothLe.supportsDiscovery, isTrue);
      expect(PrinterTransportType.bluetoothSpp.supportsDiscovery, isTrue);
    });
  });

  group('PrinterEndpoint', () {
    test('serializes and deserializes losslessly', () {
      const ep = PrinterEndpoint(
        transport: PrinterTransportType.network,
        id: '192.168.1.50:9100',
        name: '192.168.1.50',
        detail: 'TCP 192.168.1.50:9100',
        data: {'host': '192.168.1.50', 'port': 9100},
      );
      final round = PrinterEndpoint.fromJson(ep.toJson());
      expect(round.transport, ep.transport);
      expect(round.id, ep.id);
      expect(round.name, ep.name);
      expect(round.detail, ep.detail);
      expect(round.data['host'], '192.168.1.50');
      expect(round.data['port'], 9100);
    });

    test('rejects payload with no id', () {
      expect(() => PrinterEndpoint.fromJson({'transport': 'usb'}), throwsFormatException);
    });
  });

  group('PrinterSettings migration', () {
    test('migrates legacy USB-only settings ({profile, device})', () {
      final legacy = {
        'profile': 'cpcl',
        'device': {
          'deviceId': 7,
          'vendorId': 1234,
          'productId': 5678,
          'deviceName': '/dev/bus/usb/001/007',
          'productName': 'Label Printer',
        },
      };
      final s = PrinterSettings.fromJson(legacy);
      expect(s.profile, PrinterProfile.cpcl);
      expect(s.transport, PrinterTransportType.usb);
      expect(s.endpoint, isNotNull);
      expect(s.endpoint!.transport, PrinterTransportType.usb);
      expect(s.endpoint!.id, '1234:5678:7');
      // The original device JSON survives so the USB transport can reconnect.
      expect(s.endpoint!.data['deviceId'], 7);
      expect(s.endpoint!.data['vendorId'], 1234);
    });

    test('reads the new transport-aware shape', () {
      final s = PrinterSettings.fromJson({
        'profile': 'tspl',
        'transport': 'network',
        'endpoint': {
          'transport': 'network',
          'id': '10.0.0.5:9100',
          'name': '10.0.0.5',
          'detail': 'TCP 10.0.0.5:9100',
          'data': {'host': '10.0.0.5', 'port': 9100},
        },
      });
      expect(s.profile, PrinterProfile.tspl);
      expect(s.transport, PrinterTransportType.network);
      expect(s.endpoint!.data['host'], '10.0.0.5');
    });

    test('toJson/fromJson round-trips', () {
      final s = PrinterSettings(
        profile: PrinterProfile.tspl,
        transport: PrinterTransportType.bluetoothLe,
        endpoint: const PrinterEndpoint(
          transport: PrinterTransportType.bluetoothLe,
          id: 'AA:BB:CC:DD:EE:FF',
          name: 'BLE Printer',
          detail: 'RSSI -55',
        ),
      );
      final round = PrinterSettings.fromJson(s.toJson());
      expect(round.transport, PrinterTransportType.bluetoothLe);
      expect(round.endpoint!.id, 'AA:BB:CC:DD:EE:FF');
    });

    test('tolerates missing/empty endpoint', () {
      final s = PrinterSettings.fromJson({'profile': 'tspl', 'transport': 'ble'});
      expect(s.endpoint, isNull);
      expect(s.transport, PrinterTransportType.bluetoothLe);
    });
  });

  group('NetworkTransport', () {
    test('endpointFor builds host/port data with default port', () {
      final ep = NetworkTransport.endpointFor('  192.168.1.9  ');
      expect(ep.id, '192.168.1.9:9100');
      expect(ep.data['host'], '192.168.1.9');
      expect(ep.data['port'], 9100);
    });

    test('discover returns empty (manual config only)', () async {
      expect(await const NetworkTransport().discover(), isEmpty);
    });

    test('send streams every page to a TCP listener', () async {
      final server = await ServerSocket.bind('127.0.0.1', 0);
      final received = <int>[];
      final done = server.first.then((socket) async {
        await for (final chunk in socket) {
          received.addAll(chunk);
        }
      });

      final ep = NetworkTransport.endpointFor('127.0.0.1', port: server.port);
      await const NetworkTransport().send(ep, [
        Uint8List.fromList([1, 2, 3]),
        Uint8List.fromList([4, 5]),
      ]);

      await done.timeout(const Duration(seconds: 2));
      await server.close();
      expect(received, [1, 2, 3, 4, 5]);
    });

    test('send throws a clear error when the host is unreachable', () async {
      final ep = NetworkTransport.endpointFor('127.0.0.1', port: 1);
      await expectLater(
        const NetworkTransport().send(ep, [Uint8List.fromList([9])], timeoutMs: 500),
        throwsA(isA<Exception>()),
      );
    });

    test('send rejects an empty host', () async {
      const ep = PrinterEndpoint(
        transport: PrinterTransportType.network,
        id: ':9100',
        name: '',
        detail: '',
        data: {'host': '', 'port': 9100},
      );
      await expectLater(
        const NetworkTransport().send(ep, [Uint8List.fromList([1])]),
        throwsA(isA<Exception>()),
      );
    });
  });
}

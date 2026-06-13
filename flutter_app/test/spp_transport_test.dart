import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/printer/spp_transport.dart';
import 'package:freshguard_store_flutter/printer/transport.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('freshguard/bluetooth_spp');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  SppTransport build() => SppTransport(channel: channel, available: true);

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('reports Android-only availability via the injected flag', () {
    expect(SppTransport(channel: channel, available: true).isAvailable, isTrue);
    expect(SppTransport(channel: channel, available: false).isAvailable, isFalse);
    expect(build().type, PrinterTransportType.bluetoothSpp);
  });

  test('discover maps bonded devices to endpoints', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'listBondedDevices');
      return [
        {'name': 'XPrinter', 'address': 'AA:BB:CC:DD:EE:FF'},
        {'name': '', 'address': '11:22:33:44:55:66'},
      ];
    });

    final endpoints = await build().discover();
    expect(endpoints, hasLength(2));
    expect(endpoints[0].transport, PrinterTransportType.bluetoothSpp);
    expect(endpoints[0].id, 'AA:BB:CC:DD:EE:FF');
    expect(endpoints[0].name, 'XPrinter');
    expect(endpoints[0].data['address'], 'AA:BB:CC:DD:EE:FF');
    // Falls back to a generic name when the device reports none.
    expect(endpoints[1].name, 'SPP Printer');
  });

  test('discover returns empty when the platform yields null', () async {
    messenger.setMockMethodCallHandler(channel, (call) async => null);
    expect(await build().discover(), isEmpty);
  });

  test('send concatenates pages into one RFCOMM write', () async {
    Map<Object?, Object?>? captured;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'write') {
        captured = call.arguments as Map<Object?, Object?>;
        return (captured!['bytes'] as Uint8List).length;
      }
      return null;
    });

    const endpoint = PrinterEndpoint(
      transport: PrinterTransportType.bluetoothSpp,
      id: 'AA:BB:CC:DD:EE:FF',
      name: 'XPrinter',
      detail: 'SPP',
      data: {'address': 'AA:BB:CC:DD:EE:FF'},
    );
    await build().send(endpoint, [
      Uint8List.fromList([1, 2, 3]),
      Uint8List.fromList([4, 5]),
    ]);

    expect(captured!['address'], 'AA:BB:CC:DD:EE:FF');
    expect((captured!['bytes'] as Uint8List).toList(), [1, 2, 3, 4, 5]);
  });

  test('send throws when the native side reports a non-positive write', () async {
    messenger.setMockMethodCallHandler(channel, (call) async => 0);
    const endpoint = PrinterEndpoint(
      transport: PrinterTransportType.bluetoothSpp,
      id: 'AA:BB:CC:DD:EE:FF',
      name: 'XPrinter',
      detail: 'SPP',
      data: {'address': 'AA:BB:CC:DD:EE:FF'},
    );
    await expectLater(
      build().send(endpoint, [Uint8List.fromList([1])]),
      throwsA(isA<Exception>()),
    );
  });

  test('send rejects an endpoint with no address', () async {
    const endpoint = PrinterEndpoint(
      transport: PrinterTransportType.bluetoothSpp,
      id: '',
      name: '',
      detail: '',
      data: {'address': ''},
    );
    await expectLater(
      build().send(endpoint, [Uint8List.fromList([1])]),
      throwsA(isA<Exception>()),
    );
  });
}

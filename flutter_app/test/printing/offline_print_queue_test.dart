import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:freshguard_store_flutter/printing/offline_print_queue.dart';

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('freshguard_offline_test');
    Hive.init(dir.path);
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  });

  Future<OfflinePrintQueue> reopen() async {
    await Hive.box<String>(OfflinePrintQueue.boxName).close();
    return OfflinePrintQueue.open();
  }

  test('add persists across restarts and keeps id sequence', () async {
    var queue = await OfflinePrintQueue.open();
    await queue.add(productId: 7, productName: 'Milk', quantity: 2, staffId: 3);
    await queue.add(productId: 8, productName: 'Bread', quantity: 1);

    queue = await reopen();
    expect(queue.items.length, 2);
    expect(queue.items[0].productId, 7);
    expect(queue.items[0].staffId, 3);
    expect(queue.items[1].staffId, isNull);

    final next = await queue.add(productId: 9, productName: 'Eggs', quantity: 1);
    expect(next.id, 3);
  });

  test('remove deletes the item and persists', () async {
    var queue = await OfflinePrintQueue.open();
    final a = await queue.add(productId: 1, productName: 'A', quantity: 1);
    await queue.add(productId: 2, productName: 'B', quantity: 1);

    await queue.remove(a.id);
    expect(queue.items.length, 1);
    expect(queue.items.single.productId, 2);

    queue = await reopen();
    expect(queue.items.length, 1);
    expect(queue.items.single.productId, 2);
  });

  test('flush submits in order and removes successful items', () async {
    final queue = await OfflinePrintQueue.open();
    await queue.add(productId: 1, productName: 'A', quantity: 1);
    await queue.add(productId: 2, productName: 'B', quantity: 1);

    final submitted = <int>[];
    await queue.flush(
      submit: (request) async => submitted.add(request.productId),
      isNetworkError: (_) => false,
    );

    expect(submitted, [1, 2]);
    expect(queue.items, isEmpty);
    expect(queue.isFlushing, isFalse);
  });

  test('flush stops at the first network error and keeps remaining items', () async {
    final queue = await OfflinePrintQueue.open();
    await queue.add(productId: 1, productName: 'A', quantity: 1);
    await queue.add(productId: 2, productName: 'B', quantity: 1);

    final attempted = <int>[];
    await queue.flush(
      submit: (request) async {
        attempted.add(request.productId);
        throw Exception('connection refused');
      },
      isNetworkError: (_) => true,
    );

    expect(attempted, [1]);
    expect(queue.items.length, 2);
    expect(queue.isFlushing, isFalse);
  });

  test('flush records server errors and continues with the next item', () async {
    var queue = await OfflinePrintQueue.open();
    await queue.add(productId: 1, productName: 'A', quantity: 1);
    await queue.add(productId: 2, productName: 'B', quantity: 1);

    await queue.flush(
      submit: (request) async {
        if (request.productId == 1) {
          throw Exception('Product not found');
        }
      },
      isNetworkError: (_) => false,
    );

    expect(queue.items.length, 1);
    expect(queue.items.single.productId, 1);
    expect(queue.items.single.lastError, 'Product not found');

    // The recorded error survives a restart.
    queue = await reopen();
    expect(queue.items.single.lastError, 'Product not found');
  });

  test('flush on an empty queue is a no-op', () async {
    final queue = await OfflinePrintQueue.open();
    var called = false;
    await queue.flush(
      submit: (_) async => called = true,
      isNetworkError: (_) => false,
    );
    expect(called, isFalse);
  });
}

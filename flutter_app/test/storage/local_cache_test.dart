import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:freshguard_store_flutter/storage/local_cache.dart';

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('freshguard_cache_test');
    Hive.init(dir.path);
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  });

  test('putJson/getJson round-trips data with a timestamp', () async {
    final cache = await LocalCache.open();
    final before = DateTime.now();
    await cache.putJson('products', {
      'items': [
        {'id': 1, 'name': 'Milk'},
      ],
      'total': 1,
    });

    final entry = cache.getJson('products');
    expect(entry, isNotNull);
    final data = entry!.data as Map<String, dynamic>;
    expect((data['items'] as List).length, 1);
    expect(entry.savedAt.isBefore(before.subtract(const Duration(seconds: 5))), isFalse);
    expect(entry.savedAt.isAfter(DateTime.now().add(const Duration(seconds: 5))), isFalse);
  });

  test('returns null for missing keys', () async {
    final cache = await LocalCache.open();
    expect(cache.getJson('nope'), isNull);
  });

  test('returns null for corrupt values', () async {
    final cache = await LocalCache.open();
    final box = Hive.box<String>(LocalCache.boxName);
    await box.put('bad', 'not json at all');
    await box.put('no-timestamp', '{"data": []}');
    expect(cache.getJson('bad'), isNull);
    expect(cache.getJson('no-timestamp'), isNull);
  });

  test('persists across box reopen', () async {
    var cache = await LocalCache.open();
    await cache.putJson('reminders_expired', [1, 2, 3]);
    await Hive.box<String>(LocalCache.boxName).close();

    cache = await LocalCache.open();
    final entry = cache.getJson('reminders_expired');
    expect(entry, isNotNull);
    expect(entry!.data, [1, 2, 3]);
  });
}

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/printing/print_queue.dart';

Uint8List page(int marker) => Uint8List.fromList([marker]);

/// Polls until [condition] is true (or times out).
Future<void> waitFor(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for condition');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  group('PrintQueue', () {
    test('executes jobs sequentially in enqueue order', () async {
      final queue = PrintQueue(baseRetryDelay: Duration.zero);
      final written = <int>[];

      Future<void> writer(Uint8List bytes) async {
        written.add(bytes.first);
      }

      final a = queue.enqueue(description: 'a', pages: [page(1)], writer: writer);
      final b = queue.enqueue(description: 'b', pages: [page(2)], writer: writer);
      final c = queue.enqueue(description: 'c', pages: [page(3)], writer: writer);

      await waitFor(() => a.isDone && b.isDone && c.isDone);
      expect(written, [1, 2, 3]);
    });

    test('writes all pages of a multi-copy job in order', () async {
      final queue = PrintQueue(baseRetryDelay: Duration.zero);
      final written = <int>[];

      final job = queue.enqueue(
        description: 'multi',
        pages: [page(1), page(2), page(3)],
        writer: (bytes) async => written.add(bytes.first),
      );

      await waitFor(() => job.isDone);
      expect(written, [1, 2, 3]);
      expect(job.status, PrintJobStatus.done);
    });

    test('retries with backoff and marks failed after maxRetries', () async {
      final queue = PrintQueue(maxRetries: 2, baseRetryDelay: Duration.zero);
      var calls = 0;

      final job = queue.enqueue(
        description: 'always fails',
        pages: [page(1)],
        writer: (_) async {
          calls += 1;
          throw Exception('printer offline');
        },
      );

      await waitFor(() => job.isFailed);
      // Initial attempt + 2 automatic retries.
      expect(calls, 3);
      expect(job.error, 'printer offline');
    });

    test('failed job does not block later jobs', () async {
      final queue = PrintQueue(maxRetries: 0, baseRetryDelay: Duration.zero);
      final written = <int>[];

      final bad = queue.enqueue(
        description: 'bad',
        pages: [page(1)],
        writer: (_) async => throw Exception('nope'),
      );
      final good = queue.enqueue(
        description: 'good',
        pages: [page(2)],
        writer: (bytes) async => written.add(bytes.first),
      );

      await waitFor(() => bad.isFailed && good.isDone);
      expect(written, [2]);
    });

    test('manual retry resumes from the first unprinted page', () async {
      final queue = PrintQueue(maxRetries: 0, baseRetryDelay: Duration.zero);
      final written = <int>[];
      var failSecondPage = true;

      final job = queue.enqueue(
        description: 'resumable',
        pages: [page(1), page(2)],
        writer: (bytes) async {
          if (failSecondPage && bytes.first == 2) {
            throw Exception('jam');
          }
          written.add(bytes.first);
        },
      );

      await waitFor(() => job.isFailed);
      expect(written, [1]);

      failSecondPage = false;
      queue.retry(job.id);

      await waitFor(() => job.isDone);
      // Page 1 was not reprinted; the retry resumed at page 2.
      expect(written, [1, 2]);
    });

    test('clearFinished removes done and failed jobs only', () async {
      final queue = PrintQueue(maxRetries: 0, baseRetryDelay: Duration.zero);

      final done = queue.enqueue(
        description: 'done',
        pages: [page(1)],
        writer: (_) async {},
      );
      final failed = queue.enqueue(
        description: 'failed',
        pages: [page(2)],
        writer: (_) async => throw Exception('x'),
      );

      await waitFor(() => done.isDone && failed.isFailed);
      expect(queue.jobs, hasLength(2));

      queue.clearFinished();
      expect(queue.jobs, isEmpty);
    });
  });
}

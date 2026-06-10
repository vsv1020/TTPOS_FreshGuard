import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Sends one label's worth of bytes to the printer. Implementations should
/// throw on failure (e.g. permission denied or USB write error).
typedef PrintPageWriter = Future<void> Function(Uint8List bytes);

enum PrintJobStatus { queued, printing, done, failed }

/// A queued print job. May contain multiple label pages (multi-copy print);
/// pages are written sequentially within the job.
class PrintJob {
  PrintJob({
    required this.id,
    required this.description,
    required this.pages,
    required this.writer,
  });

  final int id;
  final String description;
  final List<Uint8List> pages;
  final PrintPageWriter writer;

  PrintJobStatus status = PrintJobStatus.queued;

  /// Number of fully completed attempts (initial try + automatic retries).
  int attempts = 0;

  /// Index of the next page to write; resuming a retry skips pages that
  /// were already printed successfully.
  int nextPage = 0;

  String? error;

  bool get isFailed => status == PrintJobStatus.failed;
  bool get isDone => status == PrintJobStatus.done;
}

/// Sequential print queue with automatic retries.
///
/// Jobs are executed strictly in order. A failed page write is retried with
/// exponential backoff ([baseRetryDelay], doubled per retry) up to
/// [maxRetries] automatic retries; after that the job is marked failed and
/// can be retried manually via [retry].
class PrintQueue extends ChangeNotifier {
  PrintQueue({
    this.maxRetries = 2,
    this.baseRetryDelay = const Duration(milliseconds: 500),
  });

  final int maxRetries;
  final Duration baseRetryDelay;

  final List<PrintJob> _jobs = [];
  int _nextId = 1;
  bool _processing = false;

  List<PrintJob> get jobs => List.unmodifiable(_jobs);

  bool get isProcessing => _processing;

  /// Adds a job to the queue and starts processing if idle.
  PrintJob enqueue({
    required String description,
    required List<Uint8List> pages,
    required PrintPageWriter writer,
  }) {
    final job = PrintJob(
      id: _nextId++,
      description: description,
      pages: pages,
      writer: writer,
    );
    _jobs.add(job);
    notifyListeners();
    _process();
    return job;
  }

  /// Re-queues a failed job for another round of attempts.
  void retry(int jobId) {
    for (final job in _jobs) {
      if (job.id == jobId && job.status == PrintJobStatus.failed) {
        job.status = PrintJobStatus.queued;
        job.attempts = 0;
        job.error = null;
        notifyListeners();
        _process();
        return;
      }
    }
  }

  /// Removes finished (done/failed) jobs from the visible list.
  void clearFinished() {
    _jobs.removeWhere((job) => job.isDone || job.isFailed);
    notifyListeners();
  }

  Future<void> _process() async {
    if (_processing) {
      return;
    }
    _processing = true;
    try {
      while (true) {
        PrintJob? job;
        for (final candidate in _jobs) {
          if (candidate.status == PrintJobStatus.queued) {
            job = candidate;
            break;
          }
        }
        if (job == null) {
          break;
        }
        await _runJob(job);
      }
    } finally {
      _processing = false;
      notifyListeners();
    }
  }

  Future<void> _runJob(PrintJob job) async {
    job.status = PrintJobStatus.printing;
    notifyListeners();

    while (true) {
      try {
        while (job.nextPage < job.pages.length) {
          await job.writer(job.pages[job.nextPage]);
          job.nextPage += 1;
          notifyListeners();
        }
        job.status = PrintJobStatus.done;
        job.error = null;
        notifyListeners();
        return;
      } catch (error) {
        job.attempts += 1;
        job.error = error.toString().replaceFirst('Exception: ', '');
        if (job.attempts > maxRetries) {
          job.status = PrintJobStatus.failed;
          notifyListeners();
          return;
        }
        notifyListeners();
        // Exponential backoff: base, base*2, base*4, ...
        await Future<void>.delayed(baseRetryDelay * (1 << (job.attempts - 1)));
      }
    }
  }
}

/// Compact queue status list with manual retry for failed jobs.
/// Renders nothing while the queue is empty.
class PrintQueueSection extends StatelessWidget {
  const PrintQueueSection({super.key, required this.queue});

  final PrintQueue queue;

  String _statusLabel(PrintJob job) {
    switch (job.status) {
      case PrintJobStatus.queued:
        return 'Queued';
      case PrintJobStatus.printing:
        return 'Printing ${job.nextPage}/${job.pages.length}';
      case PrintJobStatus.done:
        return 'Done (${job.pages.length} label(s))';
      case PrintJobStatus.failed:
        return 'Failed: ${job.error ?? 'unknown error'}';
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: queue,
      builder: (context, _) {
        if (queue.jobs.isEmpty) {
          return const SizedBox.shrink();
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Print queue',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton(
                  onPressed: queue.clearFinished,
                  child: const Text('Clear finished'),
                ),
              ],
            ),
            ...queue.jobs.map(
              (job) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Icon(
                      switch (job.status) {
                        PrintJobStatus.queued => Icons.schedule,
                        PrintJobStatus.printing => Icons.print,
                        PrintJobStatus.done => Icons.check_circle,
                        PrintJobStatus.failed => Icons.error,
                      },
                      size: 18,
                      color: switch (job.status) {
                        PrintJobStatus.done => Colors.green,
                        PrintJobStatus.failed => Colors.red,
                        _ => null,
                      },
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '#${job.id} ${job.description} — ${_statusLabel(job)}',
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (job.isFailed)
                      TextButton(
                        onPressed: () => queue.retry(job.id),
                        child: const Text('Retry'),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

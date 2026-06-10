import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Input for one scheduled expiry notification.
class ExpiryNotice {
  const ExpiryNotice({
    required this.id,
    required this.title,
    required this.expiresAt,
    this.promoText,
  });

  final int id;
  final String title;

  /// Expiry instant in UTC.
  final DateTime expiresAt;

  /// Optional promo suggestion (e.g. 「建议打折 20%」) appended to the body.
  final String? promoText;
}

/// Notification body for [notice]; appends the promo suggestion when present.
String expiryNoticeBody(ExpiryNotice notice) {
  final base = 'Batch expires at ${notice.expiresAt.toLocal()}';
  final promo = notice.promoText;
  if (promo == null || promo.isEmpty) {
    return base;
  }
  return '$base（$promo）';
}

/// Parses a server timestamp. Naive timestamps (no `Z`/offset) are treated
/// as UTC because the backend stores SQLite `datetime('now')` values.
DateTime? parseServerUtc(String raw) {
  final parsed = DateTime.tryParse(raw.trim());
  if (parsed == null) {
    return null;
  }
  if (parsed.isUtc) {
    return parsed;
  }
  return DateTime.utc(
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond,
    parsed.microsecond,
  );
}

/// Schedules local notifications ahead of batch expiry times.
class ReminderNotificationService {
  ReminderNotificationService._();

  static final ReminderNotificationService instance =
      ReminderNotificationService._();

  static const Duration leadTime = Duration(hours: 2);

  static const AndroidNotificationDetails _androidDetails =
      AndroidNotificationDetails(
    'expiry_reminders',
    'Expiry Reminders',
    channelDescription: 'Alerts for batches that are expiring soon',
    importance: Importance.high,
    priority: Priority.high,
  );

  static const NotificationDetails _details = NotificationDetails(
    android: _androidDetails,
    iOS: DarwinNotificationDetails(),
  );

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  /// Initializes the plugin and requests notification permission.
  /// Safe to call multiple times; failures leave the service disabled.
  Future<void> init() async {
    if (_initialized) {
      return;
    }
    try {
      tzdata.initializeTimeZones();
      const settings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      );
      await _plugin.initialize(settings: settings);
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      await _plugin
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
      _initialized = true;
    } catch (_) {
      // Notifications are best-effort (e.g. unsupported platform).
    }
  }

  /// Schedules one notification per notice at `expiresAt - leadTime`.
  ///
  /// When [reset] is true (a fresh refetch) all previously scheduled
  /// notifications are cancelled first, so re-fetching never duplicates.
  /// Notices already past their reminder point but not yet expired fire
  /// shortly after scheduling; fully expired notices are skipped (they are
  /// already visible in the reminders list).
  Future<void> syncSchedules(
    List<ExpiryNotice> notices, {
    bool reset = true,
  }) async {
    if (!_initialized) {
      return;
    }
    try {
      if (reset) {
        await _plugin.cancelAll();
      }
      final now = DateTime.now().toUtc();
      for (final notice in notices) {
        DateTime? when = notice.expiresAt.subtract(leadTime);
        if (!when.isAfter(now)) {
          when = notice.expiresAt.isAfter(now)
              ? now.add(const Duration(seconds: 5))
              : null;
        }
        if (when == null) {
          continue;
        }
        await _plugin.zonedSchedule(
          id: notice.id,
          title: 'Expiring soon: ${notice.title}',
          body: expiryNoticeBody(notice),
          scheduledDate: tz.TZDateTime.from(when, tz.UTC),
          notificationDetails: _details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        );
      }
    } catch (_) {
      // Best-effort: scheduling failures must not break the UI flow.
    }
  }
}

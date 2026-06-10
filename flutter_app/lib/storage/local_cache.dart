import 'dart:convert';

import 'package:hive/hive.dart';

/// A cached JSON payload plus the moment it was written.
class CachedEntry {
  const CachedEntry({required this.data, required this.savedAt});

  /// Raw decoded JSON exactly as the server returned it.
  final dynamic data;
  final DateTime savedAt;
}

/// Tiny key/value JSON cache on a Hive box. Used to keep the last good
/// products/reminders responses around so the app can show data offline.
class LocalCache {
  LocalCache(this._box);

  static const boxName = 'freshguard_cache';

  final Box<String> _box;

  static Future<LocalCache> open() async {
    return LocalCache(await Hive.openBox<String>(boxName));
  }

  Future<void> putJson(String key, dynamic data) async {
    await _box.put(
      key,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'data': data,
      }),
    );
  }

  /// Returns the cached entry for [key], or null when absent/corrupt.
  CachedEntry? getJson(String key) {
    final raw = _box.get(key);
    if (raw == null) {
      return null;
    }
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final savedAt = DateTime.tryParse(map['savedAt'] as String? ?? '');
      if (savedAt == null) {
        return null;
      }
      return CachedEntry(data: map['data'], savedAt: savedAt);
    } catch (_) {
      return null;
    }
  }
}

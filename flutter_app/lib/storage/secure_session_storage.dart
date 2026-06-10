import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Holds the store session (incl. the JWT) in platform secure storage.
///
/// Older builds kept the session JSON in SharedPreferences in plaintext;
/// [read] transparently migrates that value into secure storage on first
/// access and deletes the plaintext copy. Non-sensitive settings (printer
/// profile etc.) stay in SharedPreferences.
class SecureSessionStorage {
  SecureSessionStorage._();

  static final SecureSessionStorage instance = SecureSessionStorage._();

  static const _key = 'freshguard_session';

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<String?> read() async {
    String? raw;
    try {
      raw = await _storage.read(key: _key);
    } catch (_) {
      raw = null;
    }
    if (raw != null) {
      return raw;
    }

    // One-time migration from the legacy plaintext SharedPreferences entry.
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(_key);
    if (legacy == null || legacy.isEmpty) {
      return null;
    }
    try {
      await _storage.write(key: _key, value: legacy);
      await prefs.remove(_key);
    } catch (_) {
      // Secure storage unavailable: keep the legacy value usable.
    }
    return legacy;
  }

  Future<void> write(String value) async {
    await _storage.write(key: _key, value: value);
  }

  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {
      // Best effort.
    }
    // Also drop any legacy plaintext copy.
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}

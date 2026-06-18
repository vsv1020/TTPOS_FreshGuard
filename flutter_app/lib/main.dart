import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'notifications/reminder_notifications.dart';
import 'screens/bind_screen.dart';
import 'screens/kiosk_screen.dart';
import 'session.dart';
import 'storage/secure_session_storage.dart';

export 'models.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Hive.initFlutter();
  } catch (_) {
    // Local storage unavailable: the app still works online-only.
  }
  runApp(const FreshGuardStoreApp());
}

class FreshGuardStoreApp extends StatefulWidget {
  const FreshGuardStoreApp({super.key});

  @override
  State<FreshGuardStoreApp> createState() => _FreshGuardStoreAppState();
}

class _FreshGuardStoreAppState extends State<FreshGuardStoreApp> {
  AppSession? _session;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    ReminderNotificationService.instance.init();
    _loadSession();
  }

  Future<void> _loadSession() async {
    final raw = await SecureSessionStorage.instance.read();
    if (raw != null && raw.isNotEmpty) {
      try {
        final data = jsonDecode(raw) as Map<String, dynamic>;
        _session = AppSession.fromJson(data);
      } catch (_) {
        // Corrupt stored session: fall back to the bind screen.
      }
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _loading = false;
    });
  }

  Future<void> _onBound(AppSession session) async {
    await SecureSessionStorage.instance.write(jsonEncode(session.toJson()));
    if (!mounted) {
      return;
    }
    setState(() {
      _session = session;
    });
  }

  Future<void> _logout() async {
    await SecureSessionStorage.instance.clear();
    if (!mounted) {
      return;
    }
    setState(() {
      _session = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FreshGuard Store',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F766E)),
        useMaterial3: true,
      ),
      home: _loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : (_session == null
                ? BindScreen(onBound: _onBound)
                : KioskScreen(session: _session!, onLogout: _logout)),
    );
  }
}

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'network_transport.dart';
import 'printer_settings.dart';
import 'transport.dart';

/// Shared persistence layer for the saved printer configuration.
///
/// Both the admin [DashboardScreen] and the clerk-facing kiosk read the same
/// [PrinterSettings] from SharedPreferences so there is a single source of
/// truth: the admin saves the printer once, the kiosk consumes it.
class PrinterSettingsStore {
  /// Current persistence key.
  static const settingsKey = 'freshguard_printer_settings';

  /// Legacy USB-only key, read once for one-time migration of installs that
  /// saved settings before the multi-transport rework.
  static const legacyUsbSettingsKey = 'freshguard_usb_printer_settings';

  /// Loads the persisted [PrinterSettings], preferring the current key and
  /// falling back to the legacy USB-only key. Returns null when nothing is
  /// saved or the stored payload is malformed.
  static Future<PrinterSettings?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(settingsKey) ?? prefs.getString(legacyUsbSettingsKey);
    if (raw == null || raw.isEmpty) {
      return null;
    }
    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      return PrinterSettings.fromJson(parsed);
    } catch (_) {
      // Malformed local setting: treat as unconfigured.
      return null;
    }
  }

  /// Persists [settings] under the current key.
  static Future<void> save(PrinterSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(settingsKey, jsonEncode(settings.toJson()));
  }

  /// The transport types from [transports] that are also available on this
  /// platform (USB/SPP are Android-only).
  static List<PrinterTransportType> availableTransportTypes(
    List<PrinterTransport> transports,
  ) =>
      transports.where((t) => t.isAvailable).map((t) => t.type).toList();

  /// Resolves the live [PrinterEndpoint] to print to for [settings]: network
  /// endpoints are rebuilt from the saved host/port, other transports reuse the
  /// saved endpoint verbatim. Returns null when no endpoint is configured.
  ///
  /// Note: discovery transports (USB/BLE/SPP) may need a fresh scan before the
  /// saved endpoint is reachable; the kiosk treats an unreachable endpoint as a
  /// failed print job rather than re-running discovery.
  static PrinterEndpoint? resolveEndpoint(PrinterSettings settings) {
    final endpoint = settings.endpoint;
    if (endpoint == null) {
      return null;
    }
    if (endpoint.transport == PrinterTransportType.network) {
      final host = endpoint.data['host']?.toString() ?? '';
      if (host.isEmpty) {
        return null;
      }
      final port = (endpoint.data['port'] as num?)?.toInt() ?? kDefaultPrinterPort;
      return NetworkTransport.endpointFor(host, port: port);
    }
    return endpoint;
  }
}

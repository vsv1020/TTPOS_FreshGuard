import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'color_codes.dart';
import 'network.dart';
import 'notifications/reminder_notifications.dart';
import 'paging.dart';
import 'promo.dart';
import 'printer/usb_printer.dart';
import 'printing/offline_print_queue.dart';
import 'printing/print_queue.dart';
import 'scanning/scan_handle.dart';
import 'scanning/scan_page.dart';
import 'storage/local_cache.dart';
import 'storage/secure_session_storage.dart';

const _usbPrinterSettingsKey = 'freshguard_usb_printer_settings';

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
                : DashboardScreen(session: _session!, onLogout: _logout)),
    );
  }
}

class BindScreen extends StatefulWidget {
  const BindScreen({super.key, required this.onBound});

  final Future<void> Function(AppSession) onBound;

  @override
  State<BindScreen> createState() => _BindScreenState();
}

class _BindScreenState extends State<BindScreen> {
  final _baseUrlController = TextEditingController(text: 'http://10.0.2.2:4000');
  final _codeController = TextEditingController();
  final _deviceController = TextEditingController(text: 'android-flutter-device');

  bool _submitting = false;
  String? _error;
  String? _urlWarning;

  @override
  void initState() {
    super.initState();
    _urlWarning = _warningFor(_baseUrlController.text);
  }

  String? _warningFor(String url) {
    switch (checkBaseUrl(url)) {
      case BaseUrlVerdict.insecureLan:
        return 'Plain HTTP — acceptable for LAN/localhost, but the token travels unencrypted.';
      case BaseUrlVerdict.insecurePublic:
        return 'Insecure: plain HTTP to a public host. Use HTTPS.';
      case BaseUrlVerdict.secure:
      case BaseUrlVerdict.invalid:
        return null;
    }
  }

  Future<void> _bind() async {
    final baseUrl = _baseUrlController.text.trim();
    final verdict = checkBaseUrl(baseUrl);
    if (verdict == BaseUrlVerdict.invalid) {
      setState(() {
        _error = 'Enter a valid http(s) backend URL.';
      });
      return;
    }
    if (verdict == BaseUrlVerdict.insecurePublic) {
      final proceed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Insecure connection'),
          content: const Text(
            'This backend URL uses plain HTTP on a public host, so the store '
            'token would travel unencrypted. Continue anyway?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Continue'),
            ),
          ],
        ),
      );
      if (proceed != true || !mounted) {
        return;
      }
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final api = ApiClient(baseUrl: baseUrl);
      final session = await api.bindStore(
        code: _codeController.text.trim(),
        deviceId: _deviceController.text.trim(),
      );
      await widget.onBound(session);
    } catch (error) {
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  Future<void> _scanBindingCode() async {
    final code = await BarcodeScanPage.scan(context, title: 'Scan binding code');
    if (code == null || !mounted) {
      return;
    }
    setState(() {
      _codeController.text = code;
    });
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    _codeController.dispose();
    _deviceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Card(
          margin: const EdgeInsets.all(16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Bind Store Device', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  const Text('Use one-time binding code generated by admin.'),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _baseUrlController,
                    onChanged: (value) => setState(() {
                      _urlWarning = _warningFor(value);
                    }),
                    decoration: const InputDecoration(labelText: 'Backend URL'),
                  ),
                  if (_urlWarning != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      _urlWarning!,
                      style: const TextStyle(color: Colors.orange, fontSize: 12),
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: _codeController,
                    decoration: InputDecoration(
                      labelText: 'Binding code',
                      suffixIcon: IconButton(
                        tooltip: 'Scan binding code',
                        icon: const Icon(Icons.qr_code_scanner),
                        onPressed: _submitting ? null : _scanBindingCode,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _deviceController,
                    decoration: const InputDecoration(labelText: 'Device ID'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Colors.red)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _submitting ? null : _bind,
                    child: _submitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Bind'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({
    super.key,
    required this.session,
    required this.onLogout,
  });

  final AppSession session;
  final VoidCallback onLogout;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final ApiClient _api;
  final UsbPrinterService _usbPrinterService = const UsbPrinterService();
  final PrintQueue _printQueue = PrintQueue();

  final _quantityController = TextEditingController(text: '1');

  static const _pageSize = 20;

  List<ProductItem> _products = [];
  List<ReminderItem> _reminders = [];
  List<UsbPrinterDevice> _usbDevices = [];
  bool _productsHasMore = false;
  bool _remindersHasMore = false;
  bool _loadingMoreProducts = false;
  bool _loadingMoreReminders = false;
  int? _selectedProductId;
  PrinterProfile _printerProfile = PrinterProfile.tspl;
  UsbPrinterDevice? _selectedUsbDevice;
  UsbPrinterSettings _savedPrinterSettings = const UsbPrinterSettings(profile: PrinterProfile.tspl);
  String _lastBackendLabelText = '';
  LabelData? _lastBackendLabel;
  String _reminderStatus = 'expired';
  bool _busy = false;
  String? _message;

  // Offline support (null when local storage could not be opened).
  LocalCache? _cache;
  OfflinePrintQueue? _offlineQueue;
  DateTime? _offlineDataAt;
  Timer? _offlineFlushTimer;

  // Staff attribution (session-scoped, not persisted).
  StaffItem? _currentStaff;

  @override
  void initState() {
    super.initState();
    _api = ApiClient(baseUrl: widget.session.baseUrl, token: widget.session.token);
    _initializeDashboard();
  }

  Future<void> _initializeDashboard() async {
    await _openLocalStores();
    await _loadPrinterSettings();
    await _refreshUsbDevices(clearMessage: false);
    await _loadAll();
  }

  Future<void> _openLocalStores() async {
    try {
      _cache = await LocalCache.open();
      _api.cache = _cache;
      _offlineQueue = await OfflinePrintQueue.open();
      _offlineFlushTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _flushOfflineQueue(),
      );
      if (mounted) {
        // Surface any offline print requests persisted from a previous run.
        setState(() {});
      }
    } catch (_) {
      // Hive not initialized (e.g. unit tests): offline features stay off.
    }
  }

  /// Shows a staff-picker + PIN dialog.
  ///
  /// Returns:
  ///   - `(skipped: true, staff: null)`  — no staff configured, proceed without attribution.
  ///   - `(skipped: false, staff: item)` — staff verified, proceed with attribution.
  ///   - `(skipped: false, staff: null)` — user cancelled, caller should abort.
  Future<({bool skipped, StaffItem? staff})> _pickStaff() async {
    List<StaffItem> staffList;
    try {
      staffList = await _api.fetchStaff();
    } catch (error) {
      if (isNetworkError(error)) {
        // Offline: the staff list and PIN verification both need the server.
        // Proceed without attribution so the action can still be queued.
        return (skipped: true, staff: null);
      }
      if (!mounted) return (skipped: false, staff: null);
      setState(() {
        _message = 'Failed to load staff: ${error.toString().replaceFirst('Exception: ', '')}';
      });
      return (skipped: false, staff: null);
    }

    if (staffList.isEmpty) {
      return (skipped: true, staff: null);
    }

    if (!mounted) return (skipped: false, staff: null);

    final picked = await showDialog<StaffItem>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _StaffPinDialog(
        staffList: staffList,
        preSelected: _currentStaff,
        onVerify: (staffId, pin) => _api.verifyStaffPin(staffId: staffId, pin: pin),
      ),
    );
    return (skipped: false, staff: picked);
  }

  Future<void> _loadAll() async {
    setState(() {
      _busy = true;
      _message = null;
    });

    try {
      final productsFuture = _api.fetchProducts(limit: _pageSize);
      final remindersFuture = _api.fetchReminders(status: _reminderStatus, limit: _pageSize);
      final products = await productsFuture;
      final reminders = await remindersFuture;

      if (!mounted) {
        return;
      }

      setState(() {
        _products = products.items;
        _productsHasMore = products.hasMoreAfter(0);
        _reminders = reminders.items;
        _remindersHasMore = reminders.hasMoreAfter(0);
        _selectedProductId =
            _selectedProductId ?? (products.items.isNotEmpty ? products.items.first.id : null);
        _offlineDataAt = null;
      });
      _syncReminderNotifications(reminders.items);
      // Back online: replay any print requests captured while offline.
      _flushOfflineQueue();
    } catch (error) {
      if (!mounted) {
        return;
      }
      if (isNetworkError(error) && _showCachedData()) {
        return;
      }
      setState(() {
        _message = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  /// Shows the last cached products/reminders when the network is down.
  /// Returns true when any cached data was displayed.
  bool _showCachedData() {
    final productsEntry = _cache?.getJson('products');
    final remindersEntry = _cache?.getJson('reminders_$_reminderStatus');
    if (productsEntry == null && remindersEntry == null) {
      return false;
    }
    try {
      final products = productsEntry == null
          ? null
          : PagedResult.parse(productsEntry.data, 'products', ProductItem.fromJson);
      final reminders = remindersEntry == null
          ? null
          : PagedResult.parse(remindersEntry.data, 'reminders', ReminderItem.fromJson);
      setState(() {
        if (products != null) {
          _products = products.items;
          _productsHasMore = false;
          _selectedProductId ??=
              products.items.isNotEmpty ? products.items.first.id : null;
        }
        if (reminders != null) {
          _reminders = reminders.items;
          _remindersHasMore = false;
        }
        _offlineDataAt = remindersEntry?.savedAt ?? productsEntry?.savedAt;
        _message = null;
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Replays offline print requests in order: regenerates the batch on the
  /// server, then prints the returned label (quantity copies) when a USB
  /// printer is selected.
  Future<void> _flushOfflineQueue() async {
    final queue = _offlineQueue;
    if (queue == null || queue.items.isEmpty || queue.isFlushing) {
      return;
    }
    var submitted = 0;
    await queue.flush(
      isNetworkError: isNetworkError,
      submit: (request) async {
        final result = await _api.printLabels(
          productId: request.productId,
          quantity: request.quantity,
          staffId: request.staffId,
        );
        submitted += 1;
        if (!mounted) {
          return;
        }
        if (_selectedUsbDevice != null && result.labelData != null) {
          final bytes = LabelCommandBuilder.buildLabel(
            profile: _printerProfile,
            data: result.labelData!,
          );
          _enqueuePrint(
            description:
                'Offline batch #${result.batchId} (${request.productName} ×${request.quantity})',
            pages: List<Uint8List>.filled(request.quantity, bytes),
          );
        }
      },
    );
    if (submitted > 0 && mounted) {
      setState(() {
        _message = '$submitted offline print request(s) uploaded.';
      });
    }
  }

  void _syncReminderNotifications(List<ReminderItem> reminders, {bool reset = true}) {
    final notices = <ExpiryNotice>[];
    for (final reminder in reminders) {
      final expiresAt = parseServerUtc(reminder.expiresAt);
      if (expiresAt == null) {
        continue;
      }
      notices.add(ExpiryNotice(
        id: reminder.id,
        title: reminder.productName,
        expiresAt: expiresAt,
        promoText: reminder.promo != null ? promoSummaryZh(reminder.promo!) : null,
      ));
    }
    // Fire and forget; the service is best-effort and never throws.
    ReminderNotificationService.instance.syncSchedules(notices, reset: reset);
  }

  Future<void> _loadMoreProducts() async {
    if (_busy || _loadingMoreProducts || !_productsHasMore) {
      return;
    }
    _loadingMoreProducts = true;
    final offset = _products.length;
    try {
      final result = await _api.fetchProducts(limit: _pageSize, offset: offset);
      if (!mounted) {
        return;
      }
      setState(() {
        _products = [..._products, ...result.items];
        _productsHasMore = result.hasMoreAfter(offset);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      _loadingMoreProducts = false;
    }
  }

  Future<void> _loadMoreReminders() async {
    if (_busy || _loadingMoreReminders || !_remindersHasMore) {
      return;
    }
    _loadingMoreReminders = true;
    final offset = _reminders.length;
    try {
      final result = await _api.fetchReminders(
        status: _reminderStatus,
        limit: _pageSize,
        offset: offset,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _reminders = [..._reminders, ...result.items];
        _remindersHasMore = result.hasMoreAfter(offset);
      });
      _syncReminderNotifications(result.items, reset: false);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      _loadingMoreReminders = false;
    }
  }

  Future<void> _printBatch() async {
    if (_selectedProductId == null) {
      setState(() {
        _message = 'Select a product before printing.';
      });
      return;
    }

    final quantity = int.tryParse(_quantityController.text.trim());
    if (quantity == null || quantity <= 0) {
      setState(() {
        _message = 'Quantity must be a positive integer.';
      });
      return;
    }

    final staffResult = await _pickStaff();
    if (!mounted) return;
    if (!staffResult.skipped && staffResult.staff == null) {
      // User cancelled the staff/PIN dialog (or error loading staff).
      return;
    }
    if (staffResult.staff != null) {
      setState(() {
        _currentStaff = staffResult.staff;
      });
    }

    setState(() {
      _busy = true;
      _message = null;
    });

    try {
      final result = await _api.printLabels(
        productId: _selectedProductId!,
        quantity: quantity,
        staffId: _currentStaff?.id,
      );
      final reminders = await _api.fetchReminders(status: _reminderStatus, limit: _pageSize);

      if (!mounted) {
        return;
      }

      setState(() {
        _reminders = reminders.items;
        _remindersHasMore = reminders.hasMoreAfter(0);
        _lastBackendLabelText = result.labelText;
        _lastBackendLabel = result.labelData;
        _message =
            'Batch ${result.batchId} created. ${result.remindersCreated} reminders generated for expiry tracking. Backend label text loaded for test print.';
      });
      _syncReminderNotifications(reminders.items);
    } catch (error) {
      if (!mounted) {
        return;
      }
      final queue = _offlineQueue;
      if (isNetworkError(error) && queue != null) {
        // No network: keep the request locally and replay it automatically
        // once the backend is reachable again.
        final product =
            _products.where((p) => p.id == _selectedProductId).toList();
        await queue.add(
          productId: _selectedProductId!,
          productName: product.isNotEmpty
              ? product.first.name
              : 'Product #$_selectedProductId',
          quantity: quantity,
          staffId: _currentStaff?.id,
        );
        if (!mounted) {
          return;
        }
        setState(() {
          _message =
              'Network unavailable — print request queued for automatic upload when back online.';
        });
      } else {
        setState(() {
          _message = error.toString().replaceFirst('Exception: ', '');
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<void> _handleReminder(ReminderItem reminder, String reason) async {
    final staffResult = await _pickStaff();
    if (!mounted) return;
    if (!staffResult.skipped && staffResult.staff == null) {
      return;
    }
    if (staffResult.staff != null) {
      setState(() {
        _currentStaff = staffResult.staff;
      });
    }

    setState(() {
      _busy = true;
      _message = null;
    });

    try {
      await _api.handleReminder(
        reminderId: reminder.id,
        reason: reason,
        staffId: _currentStaff?.id,
      );
      final reminders = await _api.fetchReminders(status: _reminderStatus, limit: _pageSize);

      if (!mounted) {
        return;
      }

      setState(() {
        _reminders = reminders.items;
        _remindersHasMore = reminders.hasMoreAfter(0);
        _message = 'Reminder ${reminder.id} marked as $reason.';
      });
      _syncReminderNotifications(reminders.items);
    } catch (error) {
      if (!mounted) {
        return;
      }
      final raw = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        // Older servers may reject the 'discounted' action; explain why.
        _message = reason == 'discounted'
            ? '转促销售出失败（服务端可能暂不支持该动作）: $raw'
            : raw;
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<void> _loadPrinterSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_usbPrinterSettingsKey);
    if (raw == null || raw.isEmpty) {
      return;
    }

    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      final settings = UsbPrinterSettings.fromJson(parsed);
      if (!mounted) {
        return;
      }
      setState(() {
        _printerProfile = settings.profile;
        _savedPrinterSettings = settings;
        _selectedUsbDevice = settings.device;
      });
    } catch (_) {
      // Ignore malformed local setting and keep defaults.
    }
  }

  Future<void> _savePrinterSettings({bool showStatus = true}) async {
    final settings = UsbPrinterSettings(
      profile: _printerProfile,
      device: _selectedUsbDevice,
    );

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_usbPrinterSettingsKey, jsonEncode(settings.toJson()));

    if (!mounted) {
      return;
    }
    setState(() {
      _savedPrinterSettings = settings;
      if (showStatus) {
        _message = 'Printer settings saved locally.';
      }
    });
  }

  UsbPrinterDevice? _matchSavedDevice(List<UsbPrinterDevice> devices) {
    if (_selectedUsbDevice != null) {
      for (final device in devices) {
        if (device.persistentKey == _selectedUsbDevice!.persistentKey) {
          return device;
        }
      }
    }

    final saved = _savedPrinterSettings.device;
    if (saved == null) {
      return _selectedUsbDevice;
    }

    for (final device in devices) {
      final sameVendorProduct = device.vendorId == saved.vendorId && device.productId == saved.productId;
      if (sameVendorProduct && device.deviceId == saved.deviceId) {
        return device;
      }
    }

    for (final device in devices) {
      if (device.vendorId == saved.vendorId && device.productId == saved.productId) {
        return device;
      }
    }
    return _selectedUsbDevice;
  }

  Future<void> _refreshUsbDevices({bool clearMessage = true}) async {
    setState(() {
      _busy = true;
      if (clearMessage) {
        _message = null;
      }
    });

    try {
      final devices = await _usbPrinterService.listDevices();
      if (!mounted) {
        return;
      }
      setState(() {
        _usbDevices = devices;
        _selectedUsbDevice = _matchSavedDevice(devices);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<void> _testPrint() async {
    if (_selectedUsbDevice == null) {
      setState(() {
        _message = 'Select a USB device before test printing.';
      });
      return;
    }

    if (_lastBackendLabelText.trim().isEmpty) {
      setState(() {
        _message = 'No backend label text available yet. Use Print (Generate Batch) first.';
      });
      return;
    }

    final bytes = _lastBackendLabel != null
        ? LabelCommandBuilder.buildLabel(
            profile: _printerProfile,
            data: _lastBackendLabel!,
          )
        : LabelCommandBuilder.buildSample(
            profile: _printerProfile,
            labelText: _lastBackendLabelText,
          );

    final queued = _enqueuePrint(
      description: 'Test print (${_printerProfile.label})',
      pages: [bytes],
    );
    if (!queued) {
      return;
    }

    await _savePrinterSettings(showStatus: false);

    if (!mounted) {
      return;
    }
    setState(() {
      _message =
          'Test print queued using ${_printerProfile.label} for ${_selectedUsbDevice!.subtitle}.';
    });
  }

  /// Queues label bytes for the currently selected USB device. The device is
  /// captured at enqueue time so later selection changes do not affect
  /// already-queued jobs.
  bool _enqueuePrint({required String description, required List<Uint8List> pages}) {
    final device = _selectedUsbDevice;
    if (device == null) {
      setState(() {
        _message = 'Select a USB device before printing.';
      });
      return false;
    }

    _printQueue.enqueue(
      description: description,
      pages: pages,
      writer: (bytes) async {
        final granted = await _usbPrinterService.requestPermission(deviceId: device.deviceId);
        if (!granted) {
          throw Exception('USB permission denied for selected printer.');
        }
        final written = await _usbPrinterService.write(deviceId: device.deviceId, bytes: bytes);
        if (written <= 0) {
          throw Exception('USB write failed (wrote $written bytes).');
        }
      },
    );
    return true;
  }

  /// Scan a label barcode and jump straight into handling its reminder.
  Future<void> _scanToHandle() async {
    final code = await BarcodeScanPage.scan(context, title: 'Scan label barcode');
    if (code == null || !mounted) {
      return;
    }

    setState(() {
      _busy = true;
      _message = null;
    });

    Map<String, dynamic> result;
    try {
      result = await _api.fetchBatchByBarcode(code);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _message = 'Scan lookup failed: ${error.toString().replaceFirst('Exception: ', '')}';
      });
      return;
    }

    if (!mounted) {
      return;
    }
    setState(() {
      _busy = false;
    });

    final reminderJson = result['reminder'];
    if (reminderJson is! Map<String, dynamic>) {
      setState(() {
        _message = 'Batch found, but it has no pending reminder (already handled).';
      });
      return;
    }

    final reminder = ReminderItem.fromJson(reminderJson);
    final reason = await showScanHandleSheet(
      context,
      productName: reminder.productName,
      expiresAt: reminder.expiresAt,
      batchId: reminder.batchId,
    );
    if (reason == null || !mounted) {
      return;
    }
    await _handleReminder(reminder, reason);
  }

  /// Re-renders a historical batch's label on the backend and queues it for
  /// printing on the existing USB channel.
  Future<void> _reprintBatch(ReminderItem reminder) async {
    final batchId = reminder.batchId;
    if (batchId == null) {
      setState(() {
        _message = 'This reminder has no batch reference; cannot reprint.';
      });
      return;
    }
    if (_selectedUsbDevice == null) {
      setState(() {
        _message = 'Select a USB device before reprinting.';
      });
      return;
    }

    setState(() {
      _busy = true;
      _message = null;
    });

    try {
      final label = await _api.fetchBatchLabel(batchId);
      final bytes = LabelCommandBuilder.buildLabel(profile: _printerProfile, data: label);
      if (!mounted) {
        return;
      }
      final queued = _enqueuePrint(
        description: 'Reprint batch #$batchId (${reminder.productName})',
        pages: [bytes],
      );
      if (queued) {
        setState(() {
          _message = 'Reprint for batch #$batchId queued.';
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Reprint failed: ${error.toString().replaceFirst('Exception: ', '')}';
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _offlineFlushTimer?.cancel();
    _quantityController.dispose();
    _printQueue.dispose();
    super.dispose();
  }

  String _formatLocalTime(DateTime time) {
    final t = time.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text('${widget.session.brandName} / ${widget.session.storeName}'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Products & Print'),
              Tab(text: 'Reminders'),
            ],
          ),
          actions: [
            if (_currentStaff != null)
              TextButton.icon(
                onPressed: () => setState(() => _currentStaff = null),
                icon: const Icon(Icons.person, size: 18),
                label: Text(
                  _currentStaff!.name,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            IconButton(
              tooltip: 'Scan label to handle',
              onPressed: _busy ? null : _scanToHandle,
              icon: const Icon(Icons.qr_code_scanner),
            ),
            IconButton(onPressed: _busy ? null : _loadAll, icon: const Icon(Icons.refresh)),
            IconButton(onPressed: widget.onLogout, icon: const Icon(Icons.logout)),
          ],
        ),
        body: Column(
          children: [
            if (_busy) const LinearProgressIndicator(),
            if (_offlineDataAt != null)
              Container(
                width: double.infinity,
                color: Colors.amber.shade100,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    const Icon(Icons.cloud_off, size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '离线数据，更新于 ${_formatLocalTime(_offlineDataAt!)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
              ),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _message!,
                  style: TextStyle(
                    color: _message!.toLowerCase().contains('error') ? Colors.red : Colors.black,
                  ),
                ),
              ),
            Expanded(
              child: TabBarView(
                children: [
                  _buildProductsTab(context),
                  _buildRemindersTab(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProductsTab(BuildContext context) {
    return LoadMoreOnScroll(
      onLoadMore: _loadMoreProducts,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Print Labels', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  value: _selectedProductId,
                  items: _products
                      .map(
                        (item) => DropdownMenuItem<int>(
                          value: item.id,
                          child: Text('${item.name} (${item.shelfLifeDays}d)'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setState(() {
                    _selectedProductId = value;
                  }),
                  decoration: const InputDecoration(labelText: 'Product'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _quantityController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Quantity'),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _busy ? null : _printBatch,
                  child: const Text('Print (Generate Batch)'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('USB Printer', style: Theme.of(context).textTheme.titleMedium),
                    ),
                    IconButton(
                      tooltip: 'Discover USB devices',
                      onPressed: _busy ? null : () => _refreshUsbDevices(),
                      icon: const Icon(Icons.usb),
                    ),
                  ],
                ),
                Text(
                  _selectedUsbDevice == null
                      ? 'Selected: none'
                      : 'Selected: ${_selectedUsbDevice!.title} (${_selectedUsbDevice!.subtitle})',
                ),
                Text(
                  'Saved profile: ${_savedPrinterSettings.profile.label}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<PrinterProfile>(
                  value: _printerProfile,
                  decoration: const InputDecoration(labelText: 'Printer profile'),
                  items: PrinterProfile.values
                      .map(
                        (profile) => DropdownMenuItem<PrinterProfile>(
                          value: profile,
                          child: Text(profile.label),
                        ),
                      )
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (profile) {
                          if (profile == null) {
                            return;
                          }
                          setState(() {
                            _printerProfile = profile;
                          });
                        },
                ),
                const SizedBox(height: 12),
                if (_usbDevices.isEmpty)
                  const Text('No USB devices detected. Connect a printer and tap USB refresh.')
                else
                  ..._usbDevices.map(
                    (device) => RadioListTile<String>(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(device.title),
                      subtitle: Text('${device.subtitle} | Device ID ${device.deviceId}'),
                      value: device.persistentKey,
                      groupValue: _selectedUsbDevice?.persistentKey,
                      onChanged: _busy
                          ? null
                          : (_) {
                              setState(() {
                                _selectedUsbDevice = device;
                              });
                            },
                    ),
                  ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton.tonal(
                      onPressed: _busy ? null : () => _savePrinterSettings(),
                      child: const Text('Save Printer Settings'),
                    ),
                    FilledButton(
                      onPressed: _busy ? null : _testPrint,
                      child: const Text('Test Print'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _lastBackendLabelText.trim().isEmpty
                      ? 'Backend label text: unavailable. Generate a batch first.'
                      : 'Backend label text loaded and ready for test print.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                PrintQueueSection(queue: _printQueue),
                if (_offlineQueue != null)
                  OfflinePrintQueueSection(
                    queue: _offlineQueue!,
                    onUploadNow: _flushOfflineQueue,
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text('Available Products', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ..._products.map(
          (item) => Card(
            child: ListTile(
              leading: item.colorCode != null
                  ? ColorCodeDot(colorCode: item.colorCode, size: 14)
                  : null,
              title: Text(item.name),
              subtitle: Text(
                'SKU: ${item.sku ?? '-'} | Shelf life: ${item.shelfLifeDays} day(s) | Label: ${item.labelLanguage}',
              ),
            ),
          ),
        ),
        if (_products.isEmpty)
          const Card(
            child: ListTile(title: Text('No products found for this store brand.')),
          ),
        if (_productsHasMore)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
      ],
      ),
    );
  }

  Widget _buildRemindersTab(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ChoiceChip(
                label: const Text('Expired'),
                selected: _reminderStatus == 'expired',
                onSelected: (selected) {
                  if (!selected) {
                    return;
                  }
                  setState(() {
                    _reminderStatus = 'expired';
                  });
                  _loadAll();
                },
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('Expiring'),
                selected: _reminderStatus == 'expiring',
                onSelected: (selected) {
                  if (!selected) {
                    return;
                  }
                  setState(() {
                    _reminderStatus = 'expiring';
                  });
                  _loadAll();
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: LoadMoreOnScroll(
            onLoadMore: _loadMoreReminders,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _reminders.length + (_remindersHasMore ? 1 : 0),
              itemBuilder: (context, index) {
                if (index >= _reminders.length) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                }
                final reminder = _reminders[index];
                final priority = reminder.isPriority;
                return Card(
                  shape: priority
                      ? RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: const BorderSide(color: Colors.deepOrange, width: 2),
                        )
                      : null,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (reminder.colorCode != null) ...[
                              ColorCodeDot(colorCode: reminder.colorCode),
                              const SizedBox(width: 8),
                            ],
                            Expanded(
                              child: Text(reminder.productName,
                                  style: Theme.of(context).textTheme.titleMedium),
                            ),
                            if (reminder.promo != null) ...[
                              PromoBadge(promo: reminder.promo!),
                              const SizedBox(width: 6),
                            ],
                            if (priority)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.deepOrange,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Text(
                                  '应先处理',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text('Reminder #${reminder.id} | Expires: ${reminder.expiresAt}'),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final reason in kHandlingReasons)
                              priority
                                  ? FilledButton.tonal(
                                      onPressed:
                                          _busy ? null : () => _handleReminder(reminder, reason),
                                      child: Text(handlingReasonLabel(reason)),
                                    )
                                  : OutlinedButton(
                                      onPressed:
                                          _busy ? null : () => _handleReminder(reminder, reason),
                                      child: Text(handlingReasonLabel(reason)),
                                    ),
                            OutlinedButton.icon(
                              onPressed: _busy ? null : () => _reprintBatch(reminder),
                              icon: const Icon(Icons.print, size: 18),
                              label: const Text('Reprint'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        if (_reminders.isEmpty)
          const Padding(
            padding: EdgeInsets.all(20),
            child: Text('No reminders for this filter.'),
          ),
      ],
    );
  }
}

class ApiClient {
  ApiClient({required this.baseUrl, this.token, this.cache});

  final String baseUrl;
  final String? token;

  /// When set, first-page products/reminders responses are cached for
  /// offline display. Attached after the Hive box opens.
  LocalCache? cache;

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (token != null && token!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    http.Response response;
    if (method == 'POST') {
      response = await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    } else {
      response = await http.get(uri, headers: headers);
    }

    // Tolerate non-JSON bodies (e.g. plain-text 429s from proxies/rate
    // limiters) so errors surface as "HTTP <code>" instead of a decode crash.
    dynamic parsed = <String, dynamic>{};
    if (response.body.isNotEmpty) {
      try {
        parsed = jsonDecode(response.body);
      } on FormatException {
        parsed = <String, dynamic>{};
      }
    }

    if (response.statusCode >= 400) {
      final error = parsed is Map<String, dynamic>
          ? (parsed['error']?.toString() ??
              parsed['message']?.toString() ??
              'HTTP ${response.statusCode}')
          : 'HTTP ${response.statusCode}';
      throw Exception(error);
    }

    return parsed;
  }

  Future<AppSession> bindStore({required String code, required String deviceId}) async {
    final result = await _request(
      '/api/store/bind',
      method: 'POST',
      body: {
        'code': code,
        'deviceId': deviceId,
      },
    );

    final store = result['store'] as Map<String, dynamic>;
    return AppSession(
      baseUrl: baseUrl,
      token: result['token'] as String,
      storeId: (store['id'] as num).toInt(),
      brandId: (store['brandId'] as num).toInt(),
      storeName: store['name'] as String,
      brandName: store['brandName'] as String? ?? 'Brand',
    );
  }

  Future<PagedResult<ProductItem>> fetchProducts({
    int? limit,
    int offset = 0,
    String? q,
  }) async {
    final params = <String, String>{
      if (limit != null) 'limit': '$limit',
      if (limit != null && offset > 0) 'offset': '$offset',
      if (q != null && q.isNotEmpty) 'q': q,
    };
    final query = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final result = await _request('/api/store/products$query');
    if (offset == 0 && (q == null || q.isEmpty)) {
      await cache?.putJson('products', result);
    }
    return PagedResult.parse(result, 'products', ProductItem.fromJson);
  }

  Future<List<StaffItem>> fetchStaff() async {
    final result = await _request('/api/store/staff');
    final items = result['staff'] as List<dynamic>? ?? [];
    return items.map((item) => StaffItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<bool> verifyStaffPin({required int staffId, required String pin}) async {
    final result = await _request(
      '/api/store/staff/$staffId/verify-pin',
      method: 'POST',
      body: {'pin': pin},
    );
    return result['valid'] == true;
  }

  Future<PrintResult> printLabels({
    required int productId,
    required int quantity,
    int? staffId,
  }) async {
    final body = <String, dynamic>{
      'productId': productId,
      'quantity': quantity,
    };
    if (staffId != null) body['staffId'] = staffId;
    final result = await _request(
      '/api/store/print',
      method: 'POST',
      body: body,
    );

    final batch = result['batch'] as Map<String, dynamic>;
    final label = result['label'] as Map<String, dynamic>?;
    return PrintResult(
      batchId: (batch['id'] as num).toInt(),
      remindersCreated: (result['remindersCreated'] as num).toInt(),
      labelText: label?['text']?.toString() ?? '',
      labelData: label != null ? LabelData.fromBackend(label) : null,
    );
  }

  Future<PagedResult<ReminderItem>> fetchReminders({
    required String status,
    int? limit,
    int offset = 0,
  }) async {
    final params = <String, String>{
      'status': status,
      if (limit != null) 'limit': '$limit',
      if (limit != null && offset > 0) 'offset': '$offset',
    };
    final query = Uri(queryParameters: params).query;
    final result = await _request('/api/store/reminders?$query');
    if (offset == 0) {
      await cache?.putJson('reminders_$status', result);
    }
    return PagedResult.parse(result, 'reminders', ReminderItem.fromJson);
  }

  /// Looks up a batch (and its pending reminder, if any) from a scanned
  /// label barcode. Returns the raw `{batch, reminder}` payload; throws with
  /// the server message on 404.
  Future<Map<String, dynamic>> fetchBatchByBarcode(String code) async {
    final query = Uri(queryParameters: {'code': code}).query;
    final result = await _request('/api/store/batches/by-barcode?$query');
    return result as Map<String, dynamic>;
  }

  /// Re-renders the label data for a historical batch. The response shape
  /// matches the `label` object returned by `/api/store/print`.
  Future<LabelData> fetchBatchLabel(int batchId) async {
    final result = await _request('/api/store/batches/$batchId/label');
    final map = result as Map<String, dynamic>;
    final label = map['label'] is Map<String, dynamic>
        ? map['label'] as Map<String, dynamic>
        : map;
    return LabelData.fromBackend(label);
  }

  Future<void> handleReminder({
    required int reminderId,
    required String reason,
    int? staffId,
  }) async {
    final body = <String, dynamic>{'reason': reason};
    if (staffId != null) body['staffId'] = staffId;
    await _request(
      '/api/store/reminders/$reminderId/handle',
      method: 'POST',
      body: body,
    );
  }
}

class AppSession {
  const AppSession({
    required this.baseUrl,
    required this.token,
    required this.storeId,
    required this.brandId,
    required this.storeName,
    required this.brandName,
  });

  final String baseUrl;
  final String token;
  final int storeId;
  final int brandId;
  final String storeName;
  final String brandName;

  Map<String, dynamic> toJson() {
    return {
      'baseUrl': baseUrl,
      'token': token,
      'storeId': storeId,
      'brandId': brandId,
      'storeName': storeName,
      'brandName': brandName,
    };
  }

  factory AppSession.fromJson(Map<String, dynamic> json) {
    return AppSession(
      baseUrl: json['baseUrl'] as String,
      token: json['token'] as String,
      storeId: (json['storeId'] as num).toInt(),
      brandId: (json['brandId'] as num).toInt(),
      storeName: json['storeName'] as String,
      brandName: json['brandName'] as String,
    );
  }
}

class ProductItem {
  const ProductItem({
    required this.id,
    required this.name,
    required this.sku,
    required this.shelfLifeDays,
    required this.labelLanguage,
    this.colorCode,
  });

  final int id;
  final String name;
  final String? sku;
  final int shelfLifeDays;
  final String labelLanguage;

  /// 四色色标 code ('red'|'blue'|'green'|'yellow'); null for legacy data.
  final String? colorCode;

  factory ProductItem.fromJson(Map<String, dynamic> json) {
    return ProductItem(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      sku: json['sku'] as String?,
      shelfLifeDays: (json['shelfLifeDays'] as num).toInt(),
      labelLanguage: json['labelLanguage'] as String,
      colorCode: json['colorCode'] as String?,
    );
  }
}

class ReminderItem {
  const ReminderItem({
    required this.id,
    required this.productName,
    required this.expiresAt,
    this.batchId,
    this.isPriority = false,
    this.colorCode,
    this.promo,
  });

  final int id;
  final String productName;
  final String expiresAt;

  /// Source batch; used for label reprint.
  final int? batchId;

  /// FIFO hint from the server: earliest unhandled batch of its product.
  final bool isPriority;

  /// 四色色标 code of the product; null for legacy data.
  final String? colorCode;

  /// 临期促销建议; null when no promo rule matches.
  final ReminderPromo? promo;

  factory ReminderItem.fromJson(Map<String, dynamic> json) {
    return ReminderItem(
      id: (json['id'] as num).toInt(),
      productName: json['productName'] as String,
      expiresAt: json['expiresAt'] as String,
      batchId: (json['batchId'] as num?)?.toInt(),
      isPriority: json['is_priority'] == true || json['isPriority'] == true,
      colorCode: json['colorCode'] as String?,
      promo: ReminderPromo.fromJson(json['promo']),
    );
  }
}

class PrintResult {
  const PrintResult({
    required this.batchId,
    required this.remindersCreated,
    required this.labelText,
    this.labelData,
  });

  final int batchId;
  final int remindersCreated;
  final String labelText;
  final LabelData? labelData;
}

class StaffItem {
  const StaffItem({
    required this.id,
    required this.name,
    required this.role,
  });

  final int id;
  final String name;
  final String role;

  factory StaffItem.fromJson(Map<String, dynamic> json) {
    return StaffItem(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      role: json['role'] as String? ?? 'staff',
    );
  }
}

/// Modal dialog: pick a staff member then enter PIN.
/// Calls [onVerify] to check the PIN; pops with the [StaffItem] on success.
class _StaffPinDialog extends StatefulWidget {
  const _StaffPinDialog({
    required this.staffList,
    required this.onVerify,
    this.preSelected,
  });

  final List<StaffItem> staffList;
  final StaffItem? preSelected;
  final Future<bool> Function(int staffId, String pin) onVerify;

  @override
  State<_StaffPinDialog> createState() => _StaffPinDialogState();
}

class _StaffPinDialogState extends State<_StaffPinDialog> {
  late StaffItem _selected;
  final _pinController = TextEditingController();
  bool _verifying = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selected = widget.preSelected != null &&
            widget.staffList.any((s) => s.id == widget.preSelected!.id)
        ? widget.staffList.firstWhere((s) => s.id == widget.preSelected!.id)
        : widget.staffList.first;
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final pin = _pinController.text.trim();
    if (pin.isEmpty) {
      setState(() => _error = 'Enter PIN');
      return;
    }

    setState(() {
      _verifying = true;
      _error = null;
    });

    try {
      final valid = await widget.onVerify(_selected.id, pin);
      if (!mounted) return;
      if (valid) {
        Navigator.of(context).pop(_selected);
      } else {
        setState(() {
          _error = 'Incorrect PIN. Try again.';
          _verifying = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _verifying = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Operator verification'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<StaffItem>(
            value: _selected,
            decoration: const InputDecoration(labelText: 'Staff member'),
            items: widget.staffList
                .map(
                  (s) => DropdownMenuItem<StaffItem>(
                    value: s,
                    child: Text('${s.name} (${s.role})'),
                  ),
                )
                .toList(),
            onChanged: _verifying
                ? null
                : (value) {
                    if (value != null) {
                      setState(() {
                        _selected = value;
                        _error = null;
                        _pinController.clear();
                      });
                    }
                  },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pinController,
            obscureText: true,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'PIN'),
            onSubmitted: _verifying ? null : (_) => _confirm(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _verifying ? null : () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _verifying ? null : _confirm,
          child: _verifying
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Confirm'),
        ),
      ],
    );
  }
}

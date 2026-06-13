import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api_client.dart';
import '../color_codes.dart';
import '../models.dart';
import '../network.dart';
import '../notifications/reminder_notifications.dart';
import '../paging.dart';
import '../printer/ble_transport.dart';
import '../printer/network_transport.dart';
import '../printer/printer_settings.dart';
import '../printer/spp_transport.dart';
import '../printer/transport.dart';
import '../printer/usb_printer.dart';
import '../printer/usb_transport.dart';
import '../printing/offline_print_queue.dart';
import '../printing/print_queue.dart';
import '../promo.dart';
import '../scanning/scan_handle.dart';
import '../scanning/scan_page.dart';
import '../session.dart';
import '../storage/local_cache.dart';
import '../widgets/staff_pin_dialog.dart';

/// Current persistence key; [_legacyUsbPrinterSettingsKey] is read once for
/// one-time migration of installs that saved USB-only settings.
const _printerSettingsKey = 'freshguard_printer_settings';
const _legacyUsbPrinterSettingsKey = 'freshguard_usb_printer_settings';

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

  /// Registered printer transports. Each is filtered out of the picker when
  /// not available on the running platform (USB/SPP are Android-only).
  final List<PrinterTransport> _transports = [
    UsbTransport(),
    BleTransport(),
    SppTransport(),
    const NetworkTransport(),
  ];
  final PrintQueue _printQueue = PrintQueue();

  final _quantityController = TextEditingController(text: '1');
  final _netHostController = TextEditingController();
  final _netPortController = TextEditingController(text: '$kDefaultPrinterPort');

  static const _pageSize = 20;

  List<ProductItem> _products = [];
  List<ReminderItem> _reminders = [];
  List<PrinterEndpoint> _endpoints = [];
  bool _productsHasMore = false;
  bool _remindersHasMore = false;
  bool _loadingMoreProducts = false;
  bool _loadingMoreReminders = false;
  int? _selectedProductId;
  PrinterProfile _printerProfile = PrinterProfile.tspl;
  PrinterTransportType _transportType = PrinterTransportType.usb;
  PrinterEndpoint? _selectedEndpoint;
  PrinterSettings _savedPrinterSettings = const PrinterSettings(profile: PrinterProfile.tspl);
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
    // Default to the first transport available on this platform (USB on
    // Android, network on iOS) until saved settings override it.
    final available = _availableTransportTypes;
    if (available.isNotEmpty && !available.contains(_transportType)) {
      _transportType = available.first;
    }
    _initializeDashboard();
  }

  Future<void> _initializeDashboard() async {
    await _openLocalStores();
    await _loadPrinterSettings();
    if (_activeTransport.type.supportsDiscovery) {
      await _discoverEndpoints(clearMessage: false);
    }
    await _loadAll();
  }

  /// Transport types registered AND available on this platform.
  List<PrinterTransportType> get _availableTransportTypes =>
      _transports.where((t) => t.isAvailable).map((t) => t.type).toList();

  PrinterTransport get _activeTransport =>
      _transports.firstWhere((t) => t.type == _transportType);

  /// The endpoint to print to for the active transport: network is built from
  /// the host/port fields, other transports use the selected discovered device.
  PrinterEndpoint? get _currentEndpoint {
    if (_transportType == PrinterTransportType.network) {
      final host = _netHostController.text.trim();
      if (host.isEmpty) return null;
      final port = int.tryParse(_netPortController.text.trim()) ?? kDefaultPrinterPort;
      return NetworkTransport.endpointFor(host, port: port);
    }
    return _selectedEndpoint;
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
      builder: (ctx) => StaffPinDialog(
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
        if (_currentEndpoint != null && result.labelData != null) {
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
    // Prefer the current key; fall back to the legacy USB-only key so existing
    // installs migrate their saved printer on first launch.
    final raw = prefs.getString(_printerSettingsKey) ??
        prefs.getString(_legacyUsbPrinterSettingsKey);
    if (raw == null || raw.isEmpty) {
      return;
    }

    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      final settings = PrinterSettings.fromJson(parsed);
      if (!mounted) {
        return;
      }
      // Only adopt the saved transport if it is available on this platform
      // (e.g. a USB selection synced to an iOS device falls back gracefully).
      final transport = _availableTransportTypes.contains(settings.transport)
          ? settings.transport
          : (_availableTransportTypes.isNotEmpty
              ? _availableTransportTypes.first
              : settings.transport);
      setState(() {
        _printerProfile = settings.profile;
        _savedPrinterSettings = settings;
        _transportType = transport;
        _selectedEndpoint = settings.endpoint;
        if (settings.endpoint?.transport == PrinterTransportType.network) {
          _netHostController.text = settings.endpoint!.data['host']?.toString() ?? '';
          _netPortController.text =
              (settings.endpoint!.data['port'] as num?)?.toInt().toString() ??
                  '$kDefaultPrinterPort';
        }
      });
    } catch (_) {
      // Ignore malformed local setting and keep defaults.
    }
  }

  Future<void> _savePrinterSettings({bool showStatus = true}) async {
    final settings = PrinterSettings(
      profile: _printerProfile,
      transport: _transportType,
      endpoint: _currentEndpoint,
    );

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_printerSettingsKey, jsonEncode(settings.toJson()));

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

  /// Re-selects the saved endpoint from a fresh discovery scan by matching its
  /// stable id, so a reconnect keeps the user's prior choice.
  PrinterEndpoint? _matchSavedEndpoint(List<PrinterEndpoint> endpoints) {
    final target = _selectedEndpoint ?? _savedPrinterSettings.endpoint;
    if (target == null) {
      return _selectedEndpoint;
    }
    for (final endpoint in endpoints) {
      if (endpoint.id == target.id) {
        return endpoint;
      }
    }
    return _selectedEndpoint;
  }

  Future<void> _discoverEndpoints({bool clearMessage = true}) async {
    final transport = _activeTransport;
    if (!transport.type.supportsDiscovery) {
      return;
    }
    setState(() {
      _busy = true;
      if (clearMessage) {
        _message = null;
      }
    });

    try {
      final endpoints = await transport.discover();
      if (!mounted) {
        return;
      }
      setState(() {
        _endpoints = endpoints;
        _selectedEndpoint = _matchSavedEndpoint(endpoints);
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
    final endpoint = _currentEndpoint;
    if (endpoint == null) {
      setState(() {
        _message = 'Select or configure a printer before test printing.';
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
          'Test print queued using ${_printerProfile.label} over ${_transportType.label} for ${endpoint.name}.';
    });
  }

  /// Queues label bytes for the active transport + endpoint. Both are captured
  /// at enqueue time so later selection changes do not affect queued jobs.
  bool _enqueuePrint({required String description, required List<Uint8List> pages}) {
    final transport = _activeTransport;
    final endpoint = _currentEndpoint;
    if (endpoint == null) {
      setState(() {
        _message = 'Select or configure a printer before printing.';
      });
      return false;
    }

    _printQueue.enqueue(
      description: description,
      pages: pages,
      writer: (bytes) async {
        await transport.send(endpoint, [bytes]);
      },
    );
    return true;
  }

  /// Transport-specific configuration UI: manual host/port for network, or a
  /// discovered-device radio list for the scanning transports (USB/BLE/SPP).
  List<Widget> _buildTransportConfig() {
    if (_transportType == PrinterTransportType.network) {
      return [
        TextField(
          controller: _netHostController,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'Printer IP / host',
            hintText: '192.168.1.50',
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _netPortController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Port'),
          onChanged: (_) => setState(() {}),
        ),
      ];
    }

    if (_endpoints.isEmpty) {
      return [
        Text(
          'No ${_transportType.label} devices found. '
          'Make sure the printer is on and tap the search icon.',
        ),
      ];
    }

    return _endpoints
        .map(
          (endpoint) => RadioListTile<String>(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(endpoint.name),
            subtitle: Text(endpoint.detail),
            value: endpoint.id,
            groupValue: _selectedEndpoint?.id,
            onChanged: _busy
                ? null
                : (_) {
                    setState(() {
                      _selectedEndpoint = endpoint;
                    });
                  },
          ),
        )
        .toList();
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
    if (_currentEndpoint == null) {
      setState(() {
        _message = 'Select or configure a printer before reprinting.';
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
    _netHostController.dispose();
    _netPortController.dispose();
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
                      child: Text('Printer', style: Theme.of(context).textTheme.titleMedium),
                    ),
                    if (_transportType.supportsDiscovery)
                      IconButton(
                        tooltip: 'Discover ${_transportType.label} devices',
                        onPressed: _busy ? null : () => _discoverEndpoints(),
                        icon: const Icon(Icons.search),
                      ),
                  ],
                ),
                Text(
                  _currentEndpoint == null
                      ? 'Selected: none'
                      : 'Selected: ${_currentEndpoint!.name} (${_currentEndpoint!.detail})',
                ),
                Text(
                  'Saved: ${_savedPrinterSettings.transport.label} · ${_savedPrinterSettings.profile.label}',
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
                DropdownButtonFormField<PrinterTransportType>(
                  value: _availableTransportTypes.contains(_transportType)
                      ? _transportType
                      : null,
                  decoration: const InputDecoration(labelText: 'Connection'),
                  items: _availableTransportTypes
                      .map(
                        (t) => DropdownMenuItem<PrinterTransportType>(
                          value: t,
                          child: Text(t.label),
                        ),
                      )
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (transport) {
                          if (transport == null) {
                            return;
                          }
                          setState(() {
                            _transportType = transport;
                            _endpoints = [];
                            _selectedEndpoint = null;
                          });
                          if (transport.supportsDiscovery) {
                            _discoverEndpoints();
                          }
                        },
                ),
                const SizedBox(height: 12),
                ..._buildTransportConfig(),
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

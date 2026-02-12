# Android USB TSPL/CPCL Printing Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Android USB Host printing in the Flutter store app with USB device discovery/selection, TSPL/CPCL profile selection, and test-print support using backend label text.

**Architecture:** Keep existing single-file Flutter app behavior intact and add a small USB printer domain layer in Dart for config, device model, and TSPL/CPCL command builders. Bridge Flutter to Android USB Host APIs through a single method channel implemented in Kotlin (`listDevices`, `requestPermission`, `write`). Store selected USB device/profile in `SharedPreferences`, and use backend-provided label text as the primary payload in sample command templates.

**Tech Stack:** Flutter (Dart), SharedPreferences, Flutter `MethodChannel`, Android Kotlin, Android USB Host API (`UsbManager`, `UsbDevice`, `UsbDeviceConnection`, `UsbInterface`, `UsbEndpoint`), README docs.

### Task 1: Add printer domain models and test coverage (TDD)

**Files:**
- Create: `flutter_app/lib/printer/usb_printer.dart`
- Create: `flutter_app/test/printer/usb_printer_test.dart`

1. Write failing tests for:
- TSPL builder includes core TSPL setup and backend label text.
- CPCL builder includes core CPCL setup and backend label text.
- `PrinterProfile` parsing/serialization.
- USB device key generation.
2. Run `flutter test test/printer/usb_printer_test.dart` and verify failures.
3. Implement minimal models/builders in `usb_printer.dart`.
4. Re-run tests and verify pass.

### Task 2: Add Flutter platform-channel service + persisted settings

**Files:**
- Modify: `flutter_app/lib/main.dart`

1. Add USB printing service abstraction using `MethodChannel`.
2. Add local settings keys to save selected USB device/profile.
3. Load settings on dashboard startup and expose selected printer state.
4. Add API model support for backend `label.text` in print responses.

### Task 3: Update Flutter UI for discovery/profile selection + test print

**Files:**
- Modify: `flutter_app/lib/main.dart`

1. Add “USB Printer” card in products tab with:
- refresh/discover devices
- list devices with vendorId/productId/manufacturer/productName
- select/save chosen device
- profile dropdown (TSPL/CPCL)
- selected-printer summary row
2. Add “Test Print” action that:
- ensures device/profile selected
- requests USB permission through channel
- builds sample TSPL/CPCL payload from backend label text (or fallback sample)
- writes bytes via bulk transfer
3. Show clear success/error status messages.

### Task 4: Add Android Kotlin USB Host bridge

**Files:**
- Create: `flutter_app/android/src/main/kotlin/com/example/freshguard_store_flutter/MainActivity.kt`
- Create: `flutter_app/android/src/main/AndroidManifest.xml`
- Create: `flutter_app/android/src/main/res/xml/device_filter.xml`
- Create: `flutter_app/android/src/main/res/values/strings.xml`

1. Implement method channel handler methods:
- `listDevices`
- `requestPermission`
- `write`
2. Implement USB permission broadcast receiver and pending callback handling.
3. Implement endpoint discovery and bulk transfer write on OUT endpoint.
4. Return structured errors for no device/interface/endpoint/permission.

### Task 5: Documentation and verification

**Files:**
- Modify: `README.md`

1. Add Android USB setup steps for Flutter app.
2. Document required manifest entries: USB host feature, intent filter, metadata filter XML.
3. Document runtime flow: discovery -> select -> profile -> test print.
4. Run test/verification commands and record outcomes.
5. Emit completion event command:
- `openclaw system event --text "Done: Android USB TSPL/CPCL printing framework added" --mode now`

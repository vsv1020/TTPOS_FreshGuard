# TTPOS FreshGuard Core Business Features

This repo now includes:

- `backend/`: Express + SQLite backend with multi-tenant business model (`brand -> store`), admin JWT auth, store binding-code activation, label printing batches, reminders, handling logs, and reporting.
- `backend/admin-web/`: Admin web with pages for binding management, product + label language + printer configuration, and expired handling report.
- `frontend/`: Vue 3 + Vant inspection SPA; `npm run build` outputs to `backend/public/`, served by the backend at `/app`.
- `flutter_app/`: Flutter store app (bind by code, list products, print labels, view reminders, USB printer discovery/selection, TSPL/CPCL test print).
- `legacy/android/`: Original native Android scaffold, archived for reference.

## Backend Architecture (`backend/src/`)

- `server.js` — entry point; loads env, opens the DB, starts the HTTP server and reminder scan cron.
- `app.js` — `buildApp({ db, jwtSecret })`: middleware assembly (CORS, rate limiters) and router mounting only.
- `routes/` — one router module per domain (`auth`, `admin-accounts`, `admin-brands`, `admin-stores`, `admin-products`, `admin-reports`, `admin-dashboard`, `admin-label-templates`, `store`, `admin-pages`), each exporting `buildXxxRoutes({ deps })`.
- `schema.js` — `createDb`/`closeDb` and table creation.
- `repos/` — one data-access module per domain (admin-accounts, brands, stores, binding-codes, products, batches, reminders, staff, label-templates, dashboard, reports, audit).
- `lib/` — pure helpers: `util`, `csv`, `labels` (label rendering), `promo` (promo rule evaluation), `http` (response/CSV helpers).
- `db.js` — thin facade re-exporting the repo/lib surface; callers and tests import from here.
- `auth.js`, `compliance.js`, `inspection-db.js` + `inspection-routes.js` — auth middleware, compliance report builders, and the self-contained inspection module.

## Backend Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Start backend:

```bash
npm run dev
```

4. Access admin web:

- Login: `http://localhost:4000/admin/login`
- Dashboard: `http://localhost:4000/admin/dashboard`
- Binding: `http://localhost:4000/admin/binding`
- Products: `http://localhost:4000/admin/products`
- Report: `http://localhost:4000/admin/report`

Use `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

## Data Model (SQLite)

Backend creates these tables on startup:

- `users`
- `brands`
- `stores` (includes printer settings)
- `binding_codes`
- `products`
- `batches`
- `reminders`
- `handling_logs`

## REST APIs

### Auth (Admin)

- `POST /api/auth/login`
- `POST /api/auth/logout`

### Admin APIs (JWT required)

- `GET /api/admin/me`
- `GET /api/admin/users`
- `GET /api/admin/brands`
- `POST /api/admin/brands`
- `GET /api/admin/stores`
- `POST /api/admin/stores`
- `PATCH /api/admin/stores/:storeId/printer-settings`
- `GET /api/admin/binding-codes`
- `POST /api/admin/binding-codes`
- `GET /api/admin/products?brandId=<id>`
- `POST /api/admin/products`
- `GET /api/admin/reports/expired-handling`

### Store Device APIs

- `POST /api/store/bind` (public, bind code activation; returns store JWT)
- `GET /api/store/me` (store JWT)
- `GET /api/store/products` (store JWT)
- `POST /api/store/print` (store JWT; generates batch + reminders + rendered label text + store printer settings)
- `GET /api/store/reminders?status=expired|expiring|all&thresholdDays=<n>` (store JWT; `thresholdDays` default is `1`)
- `POST /api/store/reminders/:reminderId/handle` (store JWT; reason: `discarded|sold|transferred`)

### API usage examples

Admin login:

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@freshguard.local","password":"Admin123!ChangeMe"}'
```

Create brand (replace `$ADMIN_JWT`):

```bash
curl -s -X POST http://localhost:4000/api/admin/brands \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Foods"}'
```

Bind store device:

```bash
curl -s -X POST http://localhost:4000/api/store/bind \
  -H 'Content-Type: application/json' \
  -d '{"code":"AB12CD34","deviceId":"android-01"}'
```

Print labels (replace `$STORE_JWT`):

```bash
curl -s -X POST http://localhost:4000/api/store/print \
  -H "Authorization: Bearer $STORE_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"productId":1,"quantity":10}'

# Response includes:
# - batch + remindersCreated
# - store (with printer settings)
# - printerSettings
# - label: { template, productName, batchId, printedAt, expiresAt, storeName, languages, text }
```

Mark reminder handled:

```bash
curl -s -X POST http://localhost:4000/api/store/reminders/123/handle \
  -H "Authorization: Bearer $STORE_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"sold"}'
```

## Flutter Store App (`flutter_app/`)

This directory contains a minimal Flutter UI with:

- Bind via one-time code
- Product list
- Print labels (creates batch/reminders and returns rendered single/bilingual label text)
- Reminder list (`expired`, `expiring`, `all`, with `thresholdDays` defaulting to `1`)
- Handle reminder with reasons: discarded/sold/transferred
- Multi-transport label printing (see below)
- Local printer settings persistence (transport + endpoint + profile)
- Printer profile selection (`TSPL` or `CPCL`)

The app targets both **iOS and Android** from one codebase.

Quick start (on a machine with Flutter SDK installed):

```bash
cd flutter_app
flutter pub get
flutter run
```

Default backend URL in the bind screen is `http://10.0.2.2:4000` (Android emulator).

### Cross-platform label printing

Printing goes through a `PrinterTransport` abstraction (`lib/printer/`); the
pure-Dart `LabelCommandBuilder` generates TSPL/CPCL bytes and a selected
transport delivers them. The connection picker is filtered by platform:

| Transport | Android | iOS | Implementation |
|---|:--:|:--:|---|
| USB | ✅ | — | `freshguard/usb_printer` channel + Android USB Host (`MainActivity.kt`) |
| Bluetooth LE | ✅ | ✅ | `flutter_blue_plus` (1.x, BSD/free) |
| Bluetooth SPP | ✅ | — | `freshguard/bluetooth_spp` channel + Android RFCOMM (`MainActivity.kt`) |
| Network | ✅ | ✅ | pure-Dart TCP to port 9100 |

Platform constraints (not bugs): iOS has no generic USB host access, and classic
Bluetooth SPP on iOS requires MFi-certified hardware — so **iOS exposes only
BLE and network**. `flutter_blue_plus` is pinned to `^1.32.0`; its 2.x line
requires a paid commercial license, while 1.x is BSD/free.

Permissions: Android Bluetooth perms are in `AndroidManifest.xml`; iOS usage
strings (`NSBluetoothAlwaysUsageDescription`, `NSLocalNetworkUsageDescription`,
`NSCameraUsageDescription`) are in `ios/Runner/Info.plist`.

### Android USB Label Printing Setup (TSPL/CPCL)

USB printing support is implemented through Flutter method channel `freshguard/usb_printer` and Android USB Host APIs.

1. Android project files are under:
- `flutter_app/android/app/src/main/kotlin/com/example/freshguard_store_flutter/MainActivity.kt`
- `flutter_app/android/app/src/main/AndroidManifest.xml`
- `flutter_app/android/app/src/main/res/xml/device_filter.xml`

2. Android manifest requirements:
- USB host feature:
  - `<uses-feature android:name="android.hardware.usb.host" android:required="false" />`
- USB device attached intent filter on main activity:
  - `<action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />`
- USB device filter metadata:
  - `<meta-data android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" android:resource="@xml/device_filter" />`

3. Runtime flow in app:
- Open Products tab -> USB Printer card.
- Tap USB icon to discover connected devices (shows `vendorId/productId`).
- Select device and profile (`TSPL` or `CPCL`), then tap **Save Printer Settings**.
- Generate a batch first to load backend label text.
- Tap **Test Print** to request USB permission and send sample TSPL/CPCL bytes via bulk transfer.

## Tests

Backend (Jest, 15 suites under `backend/test/`):

```bash
cd backend
npm test
```

Flutter (pure-logic tests under `flutter_app/test/`):

```bash
cd flutter_app
flutter test
```

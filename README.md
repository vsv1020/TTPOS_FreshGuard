# TTPOS FreshGuard Core Business Features

This repo now includes:

- `backend/`: Express + SQLite backend with multi-tenant business model (`brand -> store`), admin JWT auth, store binding-code activation, label printing batches, reminders, handling logs, and reporting.
- `backend/admin-web/`: Admin web with pages for binding management, product + label language + printer configuration, and expired handling report.
- `flutter_app/`: Flutter store app scaffold (bind by code, list products, print labels, view reminders, USB printer discovery/selection, TSPL/CPCL test print).
- `android/`: Original native Android scaffold retained for reference.

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
- USB printer discovery for connected Android USB devices
- Local printer settings persistence (selected USB device + profile)
- Printer profile selection (`TSPL` or `CPCL`)
- Android USB Host test print via platform channel + bulk transfer write

Quick start (on a machine with Flutter SDK installed):

```bash
cd flutter_app
flutter create .
flutter pub get
flutter run
```

Default backend URL in the bind screen is `http://10.0.2.2:4000` (Android emulator).

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

Backend tests:

- `backend/test/auth.test.js`
- `backend/test/business.test.js`

Run:

```bash
cd backend
npm test
```

# Core Business Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement multi-tenant FreshGuard core business capabilities across backend, admin web, and Android-focused Flutter UI.

**Architecture:** Keep the existing Express + SQLite backend and extend it with brand/store tenancy, one-time store binding codes, product and printer configuration, printing batches, reminder/expiry tracking, and handling logs. Extend the static admin web with dedicated pages for binding/product/report. Add a minimal Flutter client that binds a store device by code, prints labels (batch creation), and handles reminders.

**Tech Stack:** Node.js, Express, SQLite, JWT, plain HTML/CSS/JS admin web, Flutter (Dart + Material + HTTP).

### Task 1: Data Model + Auth Expansion

**Files:**
- Modify: `backend/src/db.js`
- Modify: `backend/src/auth.js`

1. Add new tables: `brands`, `stores`, `binding_codes`, `products`, `batches`, `reminders`, `handling_logs`.
2. Add DB helpers for CRUD/report operations used by admin and store endpoints.
3. Extend auth helpers with store JWT signing + `requireStoreApi` middleware.
4. Keep existing admin auth behavior unchanged.

### Task 2: API Endpoints

**Files:**
- Modify: `backend/src/app.js`

1. Add admin JWT-protected APIs for brands/stores/binding codes/products/printer settings and expired-report aggregation.
2. Add store APIs for bind-by-code, product listing, print (batch creation + reminder rows), reminder retrieval (expiring/expired), and handle action logging.
3. Keep legacy `me/users` admin endpoints.

### Task 3: Backend Tests

**Files:**
- Modify: `backend/test/auth.test.js`
- Create: `backend/test/business.test.js`

1. Preserve existing auth protections.
2. Add an end-to-end test for: admin setup -> store bind -> print -> reminders -> handling -> report counts.

### Task 4: Admin Web UX

**Files:**
- Modify: `backend/admin-web/dashboard.html`
- Create: `backend/admin-web/binding.html`
- Create: `backend/admin-web/products.html`
- Create: `backend/admin-web/report.html`
- Modify: `backend/admin-web/assets/styles.css`
- Create: `backend/admin-web/assets/common.js`
- Create: `backend/admin-web/assets/binding.js`
- Create: `backend/admin-web/assets/products.js`
- Create: `backend/admin-web/assets/report.js`
- Modify: `backend/admin-web/assets/dashboard.js`

1. Add page-level navigation and logout in all pages.
2. Binding page: create/list brands/stores, generate binding codes, show active/unbound codes.
3. Product page: CRUD-lite create/list products by brand; update store printer settings.
4. Report page: show store-product expired handled/unhandled counts.

### Task 5: Flutter App Scaffold

**Files:**
- Create: `flutter_app/pubspec.yaml`
- Create: `flutter_app/lib/main.dart`

1. Implement minimal Flutter app with two states: unbound (enter code) and bound dashboard.
2. Bound dashboard includes product list, print form (product + qty), reminders list (expiring/expired), and handle action selector (discarded/sold/transferred).
3. Use backend store APIs and persist token/store metadata locally.

### Task 6: Docs + Verification

**Files:**
- Modify: `README.md`

1. Document backend env/setup, admin APIs, store APIs, admin web pages, and Flutter run steps.
2. Run backend tests (`npm test`).
3. Run required completion event command.

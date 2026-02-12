# MVP Scaffold Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build backend/admin/android MVP scaffold with admin email/password auth via JWT and protected admin APIs/web.

**Architecture:** Backend is an Express app with SQLite persistence. A `users` table stores admin records with bcrypt hashes. Login issues JWT used by API middleware and admin web route protection. Android scaffold calls the same login endpoint and stores token locally for onward API use.

**Tech Stack:** Node.js, Express, SQLite, bcryptjs, jsonwebtoken, plain HTML/CSS/JS admin web, Android (Kotlin + OkHttp).

### Task 1: Backend Test Scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/jest.config.js`
- Create: `backend/test/auth.test.js`

### Task 2: Database + Auth Utilities

**Files:**
- Create: `backend/src/db.js`
- Create: `backend/src/auth.js`

### Task 3: API Routes + Server Boot

**Files:**
- Create: `backend/src/app.js`
- Create: `backend/src/server.js`

### Task 4: Admin Web Protection + UI

**Files:**
- Create: `backend/admin-web/login.html`
- Create: `backend/admin-web/dashboard.html`
- Create: `backend/admin-web/assets/login.js`
- Create: `backend/admin-web/assets/dashboard.js`
- Create: `backend/admin-web/assets/styles.css`

### Task 5: Android Scaffold

**Files:**
- Create: `android/settings.gradle`
- Create: `android/build.gradle`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/ttpos/freshguard/admin/ApiClient.kt`
- Create: `android/app/src/main/java/com/ttpos/freshguard/admin/LoginActivity.kt`
- Create: `android/app/src/main/java/com/ttpos/freshguard/admin/DashboardActivity.kt`
- Create: `android/app/src/main/res/layout/activity_login.xml`
- Create: `android/app/src/main/res/layout/activity_dashboard.xml`
- Create: `android/app/src/main/res/values/strings.xml`

### Task 6: Docs + Env + Verification

**Files:**
- Create: `backend/.env.example`
- Create: `backend/data/.gitkeep`
- Modify: `README.md`

**Validation targets:**
- Backend tests pass
- Login and admin protection behavior validated
- Required completion event emitted

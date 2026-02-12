# TTPOS FreshGuard MVP Scaffold

This scaffold includes three slices:

- `backend/`: Node.js + Express API with SQLite admin `users` table and JWT auth.
- `backend/admin-web/`: Admin web login + dashboard protected by JWT cookie.
- `android/`: Android admin app scaffold with login flow calling backend auth API.

## Backend MVP Features

- Admin user table creation on startup (`users` table with email/password hash/role).
- Seed admin account from environment variables.
- Email/password login endpoint returning JWT and setting `admin_token` cookie.
- Protected admin APIs via JWT:
  - `GET /api/admin/me`
  - `GET /api/admin/users`
- Protected admin web routes:
  - `GET /admin/login` is public.
  - `GET /admin` and `GET /admin/dashboard` require valid admin JWT.

## Quick Start (Backend + Admin Web)

1. Install dependencies:

```bash
cd backend
npm install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Start server:

```bash
npm run dev
```

4. Open admin login:

- `http://localhost:4000/admin/login`
- Sign in using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`

## API Endpoints

- `POST /api/auth/login`
  - Body: `{ "email": "...", "password": "..." }`
  - Returns: `{ token, user }`
- `POST /api/auth/logout`
  - Clears auth cookie
- `GET /api/admin/me` (JWT required)
- `GET /api/admin/users` (JWT required)

JWT can be sent via:

- `Authorization: Bearer <token>`
- `admin_token` HTTP cookie

## Tests

Backend tests are in `backend/test/auth.test.js` and cover:

- Unauthorized admin API rejection
- Successful login + JWT response
- Admin API access with bearer token
- Wrong password rejection
- Admin web redirect to login for unauthenticated requests

Run tests:

```bash
cd backend
npm test
```

## Android Scaffold

Android project is under `android/`.

- Main login screen: `LoginActivity`
- Post-login screen: `DashboardActivity`
- API client: `ApiClient` (default backend URL `http://10.0.2.2:4000` for emulator)

Open `android/` in Android Studio and sync Gradle to continue feature development.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { buildApp } = require('./app');
const { createDb, ensureAdminUser, runReminderScan } = require('./db');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'freshguard.sqlite');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@freshguard.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!ChangeMe';

const UNSAFE_JWT_SECRET = 'change-me-in-env';
const DEFAULT_ADMIN_PASSWORD = 'Admin123!ChangeMe';

// eslint-disable-next-line no-console
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === UNSAFE_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('FATAL: JWT_SECRET is not set or is using the insecure default. Set a strong JWT_SECRET before running in production.');
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.warn('WARNING: JWT_SECRET is not set or is using the insecure default. Change it before deploying to production.');
  }
}

if (process.env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  // eslint-disable-next-line no-console
  console.warn('WARNING: ADMIN_PASSWORD is using the insecure default. Change it before deploying to production.');
}

async function start() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = await createDb(DB_FILE);
  await ensureAdminUser(db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });

  const app = buildApp({
    db,
    jwtSecret: JWT_SECRET,
    adminWebDir: path.join(__dirname, '..', 'admin-web')
  });

  // P0-1: proactive expiry reminder scan. Idempotent, so the interval only
  // affects freshness. Configurable via REMINDER_SCAN_INTERVAL_MINUTES (1-59).
  const rawInterval = Number(process.env.REMINDER_SCAN_INTERVAL_MINUTES || 10);
  const scanIntervalMinutes =
    Number.isInteger(rawInterval) && rawInterval >= 1 && rawInterval <= 59 ? rawInterval : 10;
  const scan = () =>
    runReminderScan(db)
      .then((result) => {
        if (result.backfilled || result.markedOverdue || result.markedExpiring) {
          // eslint-disable-next-line no-console
          console.log(
            `Reminder scan: backfilled=${result.backfilled} overdue=${result.markedOverdue} expiring=${result.markedExpiring}`
          );
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Reminder scan failed', error);
      });
  cron.schedule(`*/${scanIntervalMinutes} * * * *`, scan);
  await scan();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`FreshGuard backend listening on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start backend', error);
  process.exit(1);
});

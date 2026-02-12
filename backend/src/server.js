require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { buildApp } = require('./app');
const { createDb, ensureAdminUser } = require('./db');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'freshguard.sqlite');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@freshguard.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!ChangeMe';

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

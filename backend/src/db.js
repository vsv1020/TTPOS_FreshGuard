const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

async function createDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(SCHEMA_SQL);
  return db;
}

async function closeDb(db) {
  if (!db) {
    return;
  }
  await db.close();
}

async function getUserByEmail(db, email) {
  return db.get(
    `SELECT id, email, password_hash, role, created_at
     FROM users
     WHERE lower(email) = lower(?)`,
    email
  );
}

async function listAdminUsers(db) {
  return db.all(
    `SELECT id, email, role, created_at
     FROM users
     WHERE role = 'admin'
     ORDER BY id ASC`
  );
}

async function ensureAdminUser(db, { email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Admin email/password are required to seed admin user');
  }

  const existing = await getUserByEmail(db, normalizedEmail);
  if (existing) {
    return existing;
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 12);
  await db.run(
    `INSERT INTO users (email, password_hash, role)
     VALUES (?, ?, 'admin')`,
    normalizedEmail,
    passwordHash
  );

  return getUserByEmail(db, normalizedEmail);
}

module.exports = {
  closeDb,
  createDb,
  ensureAdminUser,
  getUserByEmail,
  listAdminUsers
};

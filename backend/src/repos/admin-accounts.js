const bcrypt = require('bcryptjs');
const { requirePositiveInteger, likeParam, normalizePagination } = require('../lib/util');
const { getBrandById } = require('./brands');

const ADMIN_ACCOUNT_ROLES = ['platform_admin', 'brand_admin', 'viewer'];

async function getUserByEmail(db, email) {
  return db.get(
    `SELECT id, email, password_hash, role, brand_id, disabled, created_at
     FROM users
     WHERE lower(email) = lower(?)`,
    email
  );
}

async function listAdminUsers(db) {
  return db.all(
    `SELECT id, email, role, created_at
     FROM users
     WHERE role IN ('admin', 'platform_admin', 'brand_admin', 'viewer')
     ORDER BY id ASC`
  );
}

// ─── P1-1: RBAC admin account management (platform_admin only) ───────────────

async function getAdminAccountById(db, userId) {
  return db.get(
    `SELECT id, email, role, brand_id AS brandId, disabled, created_at AS createdAt
     FROM users
     WHERE id = ?`,
    requirePositiveInteger(userId, 'userId')
  );
}

function normalizeAdminAccountRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!ADMIN_ACCOUNT_ROLES.includes(normalized)) {
    throw new Error('role must be platform_admin, brand_admin, or viewer');
  }
  return normalized;
}

// Validates the role/brandId pair: platform_admin must be brand-less,
// brand_admin must be brand-scoped, viewer may be either.
async function normalizeAdminAccountBrandId(db, role, brandId) {
  if (brandId == null || brandId === '') {
    if (role === 'brand_admin') {
      throw new Error('brandId is required for brand_admin');
    }
    return null;
  }
  if (role === 'platform_admin') {
    throw new Error('platform_admin cannot be brand-scoped');
  }
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }
  return normalizedBrandId;
}

async function listAdminAccounts(db, { q, limit, offset } = {}) {
  const whereClauses = [`role IN ('platform_admin', 'brand_admin', 'viewer')`];
  const params = [];

  if (q != null && String(q).trim()) {
    whereClauses.push('email LIKE ?');
    params.push(likeParam(q));
  }

  const fromSql = `FROM users
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id, email, role, brand_id AS brandId, disabled, created_at AS createdAt
     ${fromSql}
     ORDER BY id ASC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    return db.all(selectSql, ...params);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c ${fromSql}`, ...params);
  const items = await db.all(
    `${selectSql} LIMIT ? OFFSET ?`,
    ...params,
    pagination.limit,
    pagination.offset
  );
  return { items, total: Number(totalRow?.c || 0), limit: pagination.limit, offset: pagination.offset };
}

async function createAdminAccount(db, { email, password, role, brandId }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  if (!normalizedEmail) {
    throw new Error('email is required');
  }
  if (!normalizedPassword) {
    throw new Error('password is required');
  }
  const normalizedRole = normalizeAdminAccountRole(role);
  const normalizedBrandId = await normalizeAdminAccountBrandId(db, normalizedRole, brandId);

  const existing = await getUserByEmail(db, normalizedEmail);
  if (existing) {
    throw new Error('email already exists');
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 12);
  const result = await db.run(
    `INSERT INTO users (email, password_hash, role, brand_id)
     VALUES (?, ?, ?, ?)`,
    normalizedEmail,
    passwordHash,
    normalizedRole,
    normalizedBrandId
  );

  return getAdminAccountById(db, result.lastID);
}

async function updateAdminAccount(db, userId, fields = {}) {
  const normalizedUserId = requirePositiveInteger(userId, 'userId');
  const existing = await getAdminAccountById(db, normalizedUserId);
  if (!existing) {
    throw new Error('userId not found');
  }

  const assignments = [];
  const values = [];

  // Validate the merged role/brandId pair so a partial update cannot leave an
  // inconsistent account (e.g. brand-scoped platform_admin).
  const effectiveRole = fields.role !== undefined
    ? normalizeAdminAccountRole(fields.role)
    : existing.role;
  const effectiveBrandId = await normalizeAdminAccountBrandId(
    db,
    effectiveRole,
    fields.brandId !== undefined ? fields.brandId : existing.brandId
  );

  if (fields.role !== undefined) {
    assignments.push('role = ?');
    values.push(effectiveRole);
  }
  if (fields.role !== undefined || fields.brandId !== undefined) {
    assignments.push('brand_id = ?');
    values.push(effectiveBrandId);
  }
  if (fields.disabled !== undefined) {
    assignments.push('disabled = ?');
    values.push(fields.disabled ? 1 : 0);
  }

  if (assignments.length === 0) {
    return existing;
  }

  values.push(normalizedUserId);
  await db.run(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, ...values);
  return getAdminAccountById(db, normalizedUserId);
}

async function resetAdminAccountPassword(db, userId, newPassword) {
  const normalizedUserId = requirePositiveInteger(userId, 'userId');
  const existing = await getAdminAccountById(db, normalizedUserId);
  if (!existing) {
    throw new Error('userId not found');
  }
  const normalizedPassword = String(newPassword || '');
  if (!normalizedPassword) {
    throw new Error('newPassword is required');
  }
  const passwordHash = await bcrypt.hash(normalizedPassword, 12);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, normalizedUserId);
  return existing;
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
     VALUES (?, ?, 'platform_admin')`,
    normalizedEmail,
    passwordHash
  );

  return getUserByEmail(db, normalizedEmail);
}

module.exports = {
  getUserByEmail,
  listAdminUsers,
  getAdminAccountById,
  normalizeAdminAccountRole,
  normalizeAdminAccountBrandId,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminAccountPassword,
  ensureAdminUser
};

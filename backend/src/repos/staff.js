const bcrypt = require('bcryptjs');
const {
  requirePositiveInteger,
  likeParam,
  normalizePagination,
  nowIso
} = require('../lib/util');
const { getStoreById } = require('./stores');

// ─── Feature A: Store staff (PIN attribution, not an auth boundary) ──────────

async function getStoreStaffById(db, staffId) {
  return db.get(
    `SELECT id,
            store_id AS storeId,
            name,
            role,
            is_active AS isActive,
            created_at AS createdAt
     FROM store_staff
     WHERE id = ?`,
    requirePositiveInteger(staffId, 'staffId')
  );
}

async function createStoreStaff(db, { storeId, name, pin, role }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedName = String(name || '').trim();
  const normalizedPin = String(pin || '').trim();
  const normalizedRole = String(role || 'staff').trim().toLowerCase();

  if (!normalizedName) {
    throw new Error('Staff name is required');
  }
  if (!normalizedPin) {
    throw new Error('PIN is required');
  }
  if (normalizedRole !== 'manager' && normalizedRole !== 'staff') {
    throw new Error('role must be manager or staff');
  }

  const store = await getStoreById(db, normalizedStoreId);
  if (!store) {
    throw new Error('storeId not found');
  }

  const pinHash = await bcrypt.hash(normalizedPin, 10);
  const result = await db.run(
    `INSERT INTO store_staff (store_id, name, pin_hash, role)
     VALUES (?, ?, ?, ?)`,
    normalizedStoreId,
    normalizedName,
    pinHash,
    normalizedRole
  );

  return getStoreStaffById(db, result.lastID);
}

async function listStoreStaff(db, { storeId, includeInactive = false, q, limit, offset } = {}) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const whereClauses = ['store_id = ?'];
  const params = [normalizedStoreId];

  if (!includeInactive) {
    whereClauses.push('is_active = 1');
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('name LIKE ?');
    params.push(likeParam(q));
  }

  const fromSql = `FROM store_staff
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id,
            store_id AS storeId,
            name,
            role,
            is_active AS isActive,
            created_at AS createdAt
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

async function updateStoreStaff(db, staffId, fields = {}) {
  const normalizedStaffId = requirePositiveInteger(staffId, 'staffId');
  const existing = await getStoreStaffById(db, normalizedStaffId);
  if (!existing) {
    throw new Error('staffId not found');
  }

  const assignments = [];
  const values = [];

  if (fields.name !== undefined) {
    const name = String(fields.name || '').trim();
    if (!name) {
      throw new Error('Staff name is required');
    }
    assignments.push('name = ?');
    values.push(name);
  }
  if (fields.role !== undefined) {
    const role = String(fields.role || '').trim().toLowerCase();
    if (role !== 'manager' && role !== 'staff') {
      throw new Error('role must be manager or staff');
    }
    assignments.push('role = ?');
    values.push(role);
  }
  if (fields.isActive !== undefined) {
    assignments.push('is_active = ?');
    values.push(fields.isActive ? 1 : 0);
  }
  if (fields.pin !== undefined) {
    const pin = String(fields.pin || '').trim();
    if (!pin) {
      throw new Error('PIN is required');
    }
    assignments.push('pin_hash = ?');
    values.push(await bcrypt.hash(pin, 10));
  }

  if (assignments.length === 0) {
    return existing;
  }

  values.push(normalizedStaffId);
  await db.run(`UPDATE store_staff SET ${assignments.join(', ')} WHERE id = ?`, ...values);
  return getStoreStaffById(db, normalizedStaffId);
}

async function deactivateStoreStaff(db, staffId) {
  const normalizedStaffId = requirePositiveInteger(staffId, 'staffId');
  const existing = await getStoreStaffById(db, normalizedStaffId);
  if (!existing) {
    throw new Error('staffId not found');
  }
  await db.run('UPDATE store_staff SET is_active = 0 WHERE id = ?', normalizedStaffId);
  return getStoreStaffById(db, normalizedStaffId);
}

async function verifyStoreStaffPin(db, { storeId, staffId, pin }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedStaffId = requirePositiveInteger(staffId, 'staffId');
  const row = await db.get(
    `SELECT id, pin_hash AS pinHash
     FROM store_staff
     WHERE id = ? AND store_id = ? AND is_active = 1`,
    normalizedStaffId,
    normalizedStoreId
  );
  if (!row) {
    return false;
  }
  return bcrypt.compare(String(pin || ''), row.pinHash);
}

// ─── P1-7: verify-pin throttling (SQLite-persisted, survives restarts) ───────
// Same store+staff: 5 consecutive failures lock for 15 minutes; any success
// clears the counter.

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;

async function getPinLockState(db, { storeId, staffId }) {
  const row = await db.get(
    `SELECT locked_until AS lockedUntil
     FROM pin_attempts
     WHERE store_id = ? AND staff_id = ?`,
    requirePositiveInteger(storeId, 'storeId'),
    requirePositiveInteger(staffId, 'staffId')
  );
  if (!row || !row.lockedUntil) {
    return { locked: false };
  }
  const remainingMs = new Date(row.lockedUntil).getTime() - Date.now();
  if (remainingMs <= 0) {
    return { locked: false };
  }
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

async function recordPinFailure(db, { storeId, staffId }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedStaffId = requirePositiveInteger(staffId, 'staffId');
  await db.run(
    `INSERT INTO pin_attempts (store_id, staff_id, fail_count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(store_id, staff_id)
     DO UPDATE SET fail_count = fail_count + 1, updated_at = excluded.updated_at`,
    normalizedStoreId,
    normalizedStaffId,
    nowIso()
  );
  const row = await db.get(
    `SELECT fail_count AS failCount
     FROM pin_attempts
     WHERE store_id = ? AND staff_id = ?`,
    normalizedStoreId,
    normalizedStaffId
  );
  if (Number(row?.failCount || 0) >= PIN_MAX_FAILURES) {
    const lockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString();
    // Reset the counter so a fresh streak starts after the lock expires.
    await db.run(
      `UPDATE pin_attempts
       SET locked_until = ?, fail_count = 0, updated_at = ?
       WHERE store_id = ? AND staff_id = ?`,
      lockedUntil,
      nowIso(),
      normalizedStoreId,
      normalizedStaffId
    );
    return { locked: true, lockedUntil };
  }
  return { locked: false, failCount: Number(row?.failCount || 0) };
}

async function clearPinFailures(db, { storeId, staffId }) {
  await db.run(
    'DELETE FROM pin_attempts WHERE store_id = ? AND staff_id = ?',
    requirePositiveInteger(storeId, 'storeId'),
    requirePositiveInteger(staffId, 'staffId')
  );
}

// Resolve an optional staffId for a store; returns the numeric id if the staff
// belongs to the store and is active, otherwise throws (caller decides handling).
async function assertStoreStaff(db, storeId, staffId) {
  if (staffId == null || staffId === '') {
    return null;
  }
  const normalizedStaffId = requirePositiveInteger(staffId, 'staffId');
  const row = await db.get(
    `SELECT id FROM store_staff WHERE id = ? AND store_id = ? AND is_active = 1`,
    normalizedStaffId,
    requirePositiveInteger(storeId, 'storeId')
  );
  if (!row) {
    throw new Error('staffId not found');
  }
  return normalizedStaffId;
}

module.exports = {
  getStoreStaffById,
  createStoreStaff,
  listStoreStaff,
  updateStoreStaff,
  deactivateStoreStaff,
  verifyStoreStaffPin,
  getPinLockState,
  recordPinFailure,
  clearPinFailures,
  assertStoreStaff
};

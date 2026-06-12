const {
  requirePositiveInteger,
  likeParam,
  normalizePagination,
  nowIso,
  generateBindingCode
} = require('../lib/util');
const { getStoreById } = require('./stores');

async function getBindingCodeByCode(db, code) {
  return db.get(
    `SELECT id,
            brand_id AS brandId,
            store_id AS storeId,
            code,
            expires_at AS expiresAt,
            used_at AS usedAt,
            bound_device_id AS boundDeviceId,
            created_at AS createdAt
     FROM binding_codes
     WHERE code = ?`,
    code
  );
}

async function createBindingCode(db, { storeId, code, expiresInHours = 24 }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const store = await getStoreById(db, normalizedStoreId);
  if (!store) {
    throw new Error('storeId not found');
  }

  const hours = Number(expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('expiresInHours must be a positive number');
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const bindingCode = String(code || generateBindingCode()).trim().toUpperCase();

  await db.run(
    `INSERT INTO binding_codes (brand_id, store_id, code, expires_at)
     VALUES (?, ?, ?, ?)`,
    store.brandId,
    normalizedStoreId,
    bindingCode,
    expiresAt
  );

  return getBindingCodeByCode(db, bindingCode);
}

async function listBindingCodes(db, { brandId, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('bc.brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(bc.code LIKE ? OR s.name LIKE ?)');
    params.push(likeParam(q), likeParam(q));
  }

  const fromSql = `FROM binding_codes bc
     JOIN stores s ON s.id = bc.store_id
     JOIN brands b ON b.id = bc.brand_id
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT bc.id,
            bc.brand_id AS brandId,
            b.name AS brandName,
            bc.store_id AS storeId,
            s.name AS storeName,
            bc.code,
            bc.expires_at AS expiresAt,
            bc.used_at AS usedAt,
            bc.bound_device_id AS boundDeviceId,
            bc.created_at AS createdAt
     ${fromSql}
     ORDER BY bc.id DESC`;

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

async function consumeBindingCode(db, { code, deviceId }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedDeviceId = String(deviceId || '').trim() || null;

  if (!normalizedCode) {
    throw new Error('Binding code is required');
  }

  await db.exec('BEGIN TRANSACTION');
  try {
    const existing = await getBindingCodeByCode(db, normalizedCode);
    if (!existing) {
      throw new Error('Invalid binding code');
    }
    if (existing.usedAt) {
      throw new Error('Binding code already used');
    }
    if (existing.expiresAt && new Date(existing.expiresAt).getTime() < Date.now()) {
      throw new Error('Binding code expired');
    }

    const usedAt = nowIso();
    const updateResult = await db.run(
      `UPDATE binding_codes
       SET used_at = ?,
           bound_device_id = ?
       WHERE id = ? AND used_at IS NULL`,
      usedAt,
      normalizedDeviceId,
      existing.id
    );

    if (updateResult.changes !== 1) {
      throw new Error('Binding code already used');
    }

    const updated = await getBindingCodeByCode(db, normalizedCode);
    const store = await getStoreById(db, existing.storeId);

    await db.exec('COMMIT');
    return { bindingCode: updated, store };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  getBindingCodeByCode,
  createBindingCode,
  listBindingCodes,
  consumeBindingCode
};

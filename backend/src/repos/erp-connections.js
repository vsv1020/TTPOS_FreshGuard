const { requirePositiveInteger, nowIso, LABEL_LANGUAGE_BILINGUAL } = require('../lib/util');
const { normalizeLabelLanguage } = require('../lib/labels');
const { encryptSecret, decryptSecret } = require('../lib/erp-crypto');
const { getBrandById } = require('./brands');

// Public connection shape: NEVER includes the (encrypted) secret. `has_secret`
// tells the UI whether a secret is already stored so it can render a masked
// placeholder and leave it untouched on save.
function publicConnection(row) {
  if (!row) {
    return null;
  }
  return {
    brandId: row.brand_id,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    has_secret: Boolean(row.api_secret_enc),
    enabled: Boolean(row.enabled),
    defaultLabelLanguage: row.default_label_language,
    defaultPrimaryLanguage: row.default_primary_language,
    defaultSecondaryLanguage: row.default_secondary_language,
    defaultShelfLifeDays: row.default_shelf_life_days,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncDetail: row.last_sync_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConnectionRow(db, brandId) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  return db.get('SELECT * FROM erp_connections WHERE brand_id = ?', normalizedBrandId);
}

async function getConnection(db, brandId) {
  const row = await getConnectionRow(db, brandId);
  return publicConnection(row);
}

// Internal use only (erp-sync.js). Returns the same public fields plus the
// decrypted secret. Callers must never serialize this to a response.
async function getConnectionWithSecret(db, brandId) {
  const row = await getConnectionRow(db, brandId);
  if (!row) {
    return null;
  }
  const conn = publicConnection(row);
  conn.apiSecret = row.api_secret_enc ? decryptSecret(row.api_secret_enc) : null;
  return conn;
}

// Upsert. When `apiSecret` is omitted/blank on an existing row the stored
// (encrypted) secret is kept; a new secret is re-encrypted. Language defaults
// are normalized the same way createProduct normalizes them.
async function upsertConnection(db, brandId, fields = {}) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const existing = await getConnectionRow(db, normalizedBrandId);

  const baseUrl = String(fields.baseUrl == null ? (existing ? existing.base_url : '') : fields.baseUrl).trim();
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  const apiKey = String(fields.apiKey == null ? (existing ? existing.api_key : '') : fields.apiKey).trim();
  if (!apiKey) {
    throw new Error('apiKey is required');
  }

  // Secret handling: a non-empty new secret is encrypted; otherwise keep the
  // existing encrypted blob. A brand-new connection MUST supply a secret.
  const rawSecret = fields.apiSecret == null ? '' : String(fields.apiSecret).trim();
  let apiSecretEnc;
  if (rawSecret) {
    apiSecretEnc = encryptSecret(rawSecret);
  } else if (existing) {
    apiSecretEnc = existing.api_secret_enc;
  } else {
    throw new Error('apiSecret is required');
  }

  const enabled = fields.enabled == null
    ? (existing ? existing.enabled : 1)
    : (fields.enabled ? 1 : 0);

  const defaultLabelLanguage = normalizeLabelLanguage(
    fields.defaultLabelLanguage == null
      ? (existing ? existing.default_label_language : 'single')
      : fields.defaultLabelLanguage
  );
  const defaultPrimaryLanguage = String(
    fields.defaultPrimaryLanguage == null
      ? (existing ? existing.default_primary_language : 'th')
      : fields.defaultPrimaryLanguage
  ).trim().toLowerCase() || 'th';
  const defaultSecondaryLanguage = String(
    fields.defaultSecondaryLanguage == null
      ? (existing ? (existing.default_secondary_language || '') : '')
      : fields.defaultSecondaryLanguage
  ).trim().toLowerCase() || null;

  if (defaultLabelLanguage === LABEL_LANGUAGE_BILINGUAL && !defaultSecondaryLanguage) {
    throw new Error('defaultSecondaryLanguage is required for bilingual labels');
  }

  const rawShelfLife = fields.defaultShelfLifeDays == null
    ? (existing ? existing.default_shelf_life_days : 1)
    : fields.defaultShelfLifeDays;
  const parsedShelfLife = parseInt(rawShelfLife, 10);
  const defaultShelfLifeDays = Number.isFinite(parsedShelfLife) && parsedShelfLife > 0 ? parsedShelfLife : 1;

  const now = nowIso();
  if (existing) {
    await db.run(
      `UPDATE erp_connections
       SET base_url = ?, api_key = ?, api_secret_enc = ?, enabled = ?,
           default_label_language = ?, default_primary_language = ?, default_secondary_language = ?,
           default_shelf_life_days = ?, updated_at = ?
       WHERE brand_id = ?`,
      baseUrl,
      apiKey,
      apiSecretEnc,
      enabled,
      defaultLabelLanguage,
      defaultPrimaryLanguage,
      defaultSecondaryLanguage,
      defaultShelfLifeDays,
      now,
      normalizedBrandId
    );
  } else {
    await db.run(
      `INSERT INTO erp_connections (
        brand_id, base_url, api_key, api_secret_enc, enabled,
        default_label_language, default_primary_language, default_secondary_language,
        default_shelf_life_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalizedBrandId,
      baseUrl,
      apiKey,
      apiSecretEnc,
      enabled,
      defaultLabelLanguage,
      defaultPrimaryLanguage,
      defaultSecondaryLanguage,
      defaultShelfLifeDays,
      now,
      now
    );
  }

  return getConnection(db, normalizedBrandId);
}

async function setSyncStatus(db, brandId, { at, status, detail } = {}) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  await db.run(
    `UPDATE erp_connections
     SET last_sync_at = ?, last_sync_status = ?, last_sync_detail = ?, updated_at = ?
     WHERE brand_id = ?`,
    at != null ? String(at) : null,
    status != null ? String(status) : null,
    detail != null ? String(detail) : null,
    nowIso(),
    normalizedBrandId
  );
}

async function getSelections(db, brandId) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  return db.all(
    `SELECT item_group AS itemGroup, enabled
     FROM erp_category_selections
     WHERE brand_id = ?
     ORDER BY item_group ASC`,
    normalizedBrandId
  );
}

// Replaces the brand's selection set with the given item groups (all enabled).
// Runs in a single transaction so a partial write can't leave a stale set.
async function setSelections(db, brandId, itemGroups = []) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const groups = Array.from(
    new Set(
      (Array.isArray(itemGroups) ? itemGroups : [])
        .map((g) => String(g == null ? '' : g).trim())
        .filter(Boolean)
    )
  );

  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('DELETE FROM erp_category_selections WHERE brand_id = ?', normalizedBrandId);
    for (const itemGroup of groups) {
      await db.run(
        `INSERT INTO erp_category_selections (brand_id, item_group, enabled)
         VALUES (?, ?, 1)`,
        normalizedBrandId,
        itemGroup
      );
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  return getSelections(db, normalizedBrandId);
}

module.exports = {
  getConnection,
  getConnectionWithSecret,
  upsertConnection,
  setSyncStatus,
  getSelections,
  setSelections
};

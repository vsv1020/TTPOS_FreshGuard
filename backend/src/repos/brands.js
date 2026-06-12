const { requirePositiveInteger } = require('../lib/util');
const { normalizePromoRules, parsePromoRules } = require('../lib/promo');

async function getBrandById(db, brandId) {
  return db.get(
    `SELECT id, name, created_at AS createdAt
     FROM brands
     WHERE id = ?`,
    brandId
  );
}

async function createBrand(db, { name }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('Brand name is required');
  }

  const result = await db.run('INSERT INTO brands (name) VALUES (?)', normalizedName);
  return getBrandById(db, result.lastID);
}

async function listBrands(db) {
  return db.all(
    `SELECT id, name, created_at AS createdAt
     FROM brands
     ORDER BY id ASC`
  );
}

async function getBrandPromoRules(db, brandId) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const row = await db.get(
    'SELECT id, promo_rules AS promoRules FROM brands WHERE id = ?',
    normalizedBrandId
  );
  if (!row) {
    throw new Error('brandId not found');
  }
  return { brandId: row.id, rules: parsePromoRules(row.promoRules) };
}

async function updateBrandPromoRules(db, brandId, { rules } = {}) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }
  const normalizedRules = normalizePromoRules(rules);
  await db.run(
    'UPDATE brands SET promo_rules = ? WHERE id = ?',
    normalizedRules.length > 0 ? JSON.stringify(normalizedRules) : null,
    normalizedBrandId
  );
  return { brandId: normalizedBrandId, rules: normalizedRules };
}

// ─── Brand-level reminder config (expiring threshold, in days) ───────────────

async function getBrandReminderConfig(db, brandId) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const row = await db.get(
    `SELECT id, reminder_threshold_days AS thresholdDays
     FROM brands
     WHERE id = ?`,
    normalizedBrandId
  );
  if (!row) {
    throw new Error('brandId not found');
  }
  return {
    brandId: row.id,
    thresholdDays: row.thresholdDays != null ? row.thresholdDays : 1
  };
}

async function updateBrandReminderConfig(db, brandId, { thresholdDays } = {}) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const normalizedThresholdDays = Number(thresholdDays);
  if (!Number.isInteger(normalizedThresholdDays) || normalizedThresholdDays < 0) {
    throw new Error('thresholdDays must be a non-negative integer');
  }

  await db.run(
    'UPDATE brands SET reminder_threshold_days = ? WHERE id = ?',
    normalizedThresholdDays,
    normalizedBrandId
  );

  return getBrandReminderConfig(db, normalizedBrandId);
}

module.exports = {
  getBrandById,
  createBrand,
  listBrands,
  getBrandPromoRules,
  updateBrandPromoRules,
  getBrandReminderConfig,
  updateBrandReminderConfig
};

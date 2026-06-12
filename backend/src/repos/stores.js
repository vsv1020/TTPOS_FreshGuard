const { requirePositiveInteger, nowIso } = require('../lib/util');
const { getBrandById } = require('./brands');

async function getStoreById(db, storeId) {
  return db.get(
    `SELECT s.id,
            s.brand_id AS brandId,
            b.name AS brandName,
            s.name,
            s.printer_name AS printerName,
            s.printer_model AS printerModel,
            s.printer_address AS printerAddress,
            s.printer_port AS printerPort,
            s.printer_dpi AS printerDpi,
            s.label_width_mm AS labelWidthMm,
            s.token_version AS tokenVersion,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt
     FROM stores s
     JOIN brands b ON b.id = s.brand_id
     WHERE s.id = ?`,
    storeId
  );
}

// P1-7: bump the store token version so every previously issued store JWT
// (which embeds the version at signing time) becomes invalid.
async function incrementStoreTokenVersion(db, storeId) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const existing = await getStoreById(db, normalizedStoreId);
  if (!existing) {
    throw new Error('storeId not found');
  }
  await db.run(
    'UPDATE stores SET token_version = token_version + 1, updated_at = ? WHERE id = ?',
    nowIso(),
    normalizedStoreId
  );
  return getStoreById(db, normalizedStoreId);
}

async function listStores(db, { brandId } = {}) {
  if (brandId != null) {
    const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
    return db.all(
      `SELECT s.id,
              s.brand_id AS brandId,
              b.name AS brandName,
              s.name,
              s.printer_name AS printerName,
              s.printer_model AS printerModel,
              s.printer_address AS printerAddress,
              s.printer_port AS printerPort,
              s.printer_dpi AS printerDpi,
              s.label_width_mm AS labelWidthMm,
              s.created_at AS createdAt,
              s.updated_at AS updatedAt
       FROM stores s
       JOIN brands b ON b.id = s.brand_id
       WHERE s.brand_id = ?
       ORDER BY s.id ASC`,
      normalizedBrandId
    );
  }

  return db.all(
    `SELECT s.id,
            s.brand_id AS brandId,
            b.name AS brandName,
            s.name,
            s.printer_name AS printerName,
            s.printer_model AS printerModel,
            s.printer_address AS printerAddress,
            s.printer_port AS printerPort,
            s.printer_dpi AS printerDpi,
            s.label_width_mm AS labelWidthMm,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt
     FROM stores s
     JOIN brands b ON b.id = s.brand_id
     ORDER BY s.id ASC`
  );
}

async function createStore(db, { brandId, name }) {
  const normalizedName = String(name || '').trim();
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');

  if (!normalizedName) {
    throw new Error('Store name is required');
  }

  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const result = await db.run(
    `INSERT INTO stores (brand_id, name)
     VALUES (?, ?)`,
    normalizedBrandId,
    normalizedName
  );

  return getStoreById(db, result.lastID);
}

async function updateStorePrinterSettings(db, storeId, settings = {}) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const existing = await getStoreById(db, normalizedStoreId);
  if (!existing) {
    throw new Error('storeId not found');
  }

  const patch = {
    printer_name: settings.printerName ?? existing.printerName,
    printer_model: settings.printerModel ?? existing.printerModel,
    printer_address: settings.printerAddress ?? existing.printerAddress,
    printer_port: settings.printerPort ?? existing.printerPort,
    printer_dpi: settings.printerDpi ?? existing.printerDpi,
    label_width_mm: settings.labelWidthMm ?? existing.labelWidthMm
  };

  if (patch.printer_port != null && !Number.isInteger(Number(patch.printer_port))) {
    throw new Error('printerPort must be an integer');
  }

  if (patch.printer_dpi != null && !Number.isInteger(Number(patch.printer_dpi))) {
    throw new Error('printerDpi must be an integer');
  }

  if (patch.label_width_mm != null && !Number.isInteger(Number(patch.label_width_mm))) {
    throw new Error('labelWidthMm must be an integer');
  }

  await db.run(
    `UPDATE stores
     SET printer_name = ?,
         printer_model = ?,
         printer_address = ?,
         printer_port = ?,
         printer_dpi = ?,
         label_width_mm = ?,
         updated_at = ?
     WHERE id = ?`,
    patch.printer_name,
    patch.printer_model,
    patch.printer_address,
    patch.printer_port != null ? Number(patch.printer_port) : null,
    patch.printer_dpi != null ? Number(patch.printer_dpi) : null,
    patch.label_width_mm != null ? Number(patch.label_width_mm) : null,
    nowIso(),
    normalizedStoreId
  );

  return getStoreById(db, normalizedStoreId);
}

module.exports = {
  getStoreById,
  incrementStoreTokenVersion,
  listStores,
  createStore,
  updateStorePrinterSettings
};

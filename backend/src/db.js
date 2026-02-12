const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const LABEL_LANGUAGE_SINGLE = 'single';
const LABEL_LANGUAGE_BILINGUAL = 'bilingual';
const HANDLING_REASONS = ['discarded', 'sold', 'transferred'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  printer_name TEXT,
  printer_model TEXT,
  printer_address TEXT,
  printer_port INTEGER,
  printer_dpi INTEGER,
  label_width_mm INTEGER DEFAULT 58,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_id, name),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS binding_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  used_at TEXT,
  bound_device_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  shelf_life_days INTEGER NOT NULL,
  label_language TEXT NOT NULL CHECK (label_language IN ('single', 'bilingual')),
  primary_language TEXT NOT NULL DEFAULT 'en',
  secondary_language TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_id, name),
  UNIQUE (brand_id, sku),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  printed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS handling_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('discarded', 'sold', 'transferred')),
  note TEXT,
  handled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stores_brand ON stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_binding_codes_store ON binding_codes(store_id);
CREATE INDEX IF NOT EXISTS idx_reminders_store_expires ON reminders(store_id, expires_at);
`;

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function requirePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function normalizeLabelLanguage(labelLanguage) {
  const value = String(labelLanguage || LABEL_LANGUAGE_SINGLE).trim().toLowerCase();
  if (value !== LABEL_LANGUAGE_SINGLE && value !== LABEL_LANGUAGE_BILINGUAL) {
    throw new Error('labelLanguage must be single or bilingual');
  }
  return value;
}

function generateBindingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function createDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
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
            s.created_at AS createdAt,
            s.updated_at AS updatedAt
     FROM stores s
     JOIN brands b ON b.id = s.brand_id
     WHERE s.id = ?`,
    storeId
  );
}

async function listStores(db) {
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

async function listBindingCodes(db) {
  return db.all(
    `SELECT bc.id,
            bc.brand_id AS brandId,
            b.name AS brandName,
            bc.store_id AS storeId,
            s.name AS storeName,
            bc.code,
            bc.expires_at AS expiresAt,
            bc.used_at AS usedAt,
            bc.bound_device_id AS boundDeviceId,
            bc.created_at AS createdAt
     FROM binding_codes bc
     JOIN stores s ON s.id = bc.store_id
     JOIN brands b ON b.id = bc.brand_id
     ORDER BY bc.id DESC`
  );
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

async function getProductById(db, productId) {
  return db.get(
    `SELECT p.id,
            p.brand_id AS brandId,
            b.name AS brandName,
            p.name,
            p.sku,
            p.shelf_life_days AS shelfLifeDays,
            p.label_language AS labelLanguage,
            p.primary_language AS primaryLanguage,
            p.secondary_language AS secondaryLanguage,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt
     FROM products p
     JOIN brands b ON b.id = p.brand_id
     WHERE p.id = ?`,
    productId
  );
}

async function createProduct(
  db,
  { brandId, name, sku, shelfLifeDays, labelLanguage, primaryLanguage, secondaryLanguage }
) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const normalizedName = String(name || '').trim();
  const normalizedSku = String(sku || '').trim() || null;
  const normalizedShelfLifeDays = Number(shelfLifeDays);

  if (!normalizedName) {
    throw new Error('Product name is required');
  }
  if (!Number.isInteger(normalizedShelfLifeDays) || normalizedShelfLifeDays <= 0) {
    throw new Error('shelfLifeDays must be a positive integer');
  }

  const normalizedLabelLanguage = normalizeLabelLanguage(labelLanguage);
  const normalizedPrimaryLanguage = String(primaryLanguage || 'en').trim().toLowerCase();
  const normalizedSecondaryLanguage = String(secondaryLanguage || '')
    .trim()
    .toLowerCase() || null;

  if (normalizedLabelLanguage === LABEL_LANGUAGE_BILINGUAL && !normalizedSecondaryLanguage) {
    throw new Error('secondaryLanguage is required for bilingual labels');
  }

  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const result = await db.run(
    `INSERT INTO products (
      brand_id,
      name,
      sku,
      shelf_life_days,
      label_language,
      primary_language,
      secondary_language
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    normalizedBrandId,
    normalizedName,
    normalizedSku,
    normalizedShelfLifeDays,
    normalizedLabelLanguage,
    normalizedPrimaryLanguage,
    normalizedSecondaryLanguage
  );

  return getProductById(db, result.lastID);
}

async function listProducts(db, { brandId } = {}) {
  if (brandId != null) {
    const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
    return db.all(
      `SELECT p.id,
              p.brand_id AS brandId,
              b.name AS brandName,
              p.name,
              p.sku,
              p.shelf_life_days AS shelfLifeDays,
              p.label_language AS labelLanguage,
              p.primary_language AS primaryLanguage,
              p.secondary_language AS secondaryLanguage,
              p.created_at AS createdAt,
              p.updated_at AS updatedAt
       FROM products p
       JOIN brands b ON b.id = p.brand_id
       WHERE p.brand_id = ?
       ORDER BY p.id ASC`,
      normalizedBrandId
    );
  }

  return db.all(
    `SELECT p.id,
            p.brand_id AS brandId,
            b.name AS brandName,
            p.name,
            p.sku,
            p.shelf_life_days AS shelfLifeDays,
            p.label_language AS labelLanguage,
            p.primary_language AS primaryLanguage,
            p.secondary_language AS secondaryLanguage,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt
     FROM products p
     JOIN brands b ON b.id = p.brand_id
     ORDER BY p.id ASC`
  );
}

async function listStoreProducts(db, storeId) {
  const store = await getStoreById(db, storeId);
  if (!store) {
    throw new Error('storeId not found');
  }

  return listProducts(db, { brandId: store.brandId });
}

async function createBatchWithReminders(db, { storeId, productId, quantity, printedAt }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedProductId = requirePositiveInteger(productId, 'productId');
  const normalizedQuantity = requirePositiveInteger(quantity, 'quantity');
  if (normalizedQuantity > 500) {
    throw new Error('quantity cannot exceed 500');
  }

  const store = await getStoreById(db, normalizedStoreId);
  if (!store) {
    throw new Error('storeId not found');
  }

  const product = await getProductById(db, normalizedProductId);
  if (!product) {
    throw new Error('productId not found');
  }

  if (product.brandId !== store.brandId) {
    throw new Error('product does not belong to this store brand');
  }

  const printedAtIso = printedAt ? new Date(printedAt).toISOString() : nowIso();
  const expiresAtIso = addDaysIso(printedAtIso, product.shelfLifeDays);

  await db.exec('BEGIN TRANSACTION');
  try {
    const batchInsert = await db.run(
      `INSERT INTO batches (store_id, product_id, quantity, printed_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      normalizedStoreId,
      normalizedProductId,
      normalizedQuantity,
      printedAtIso,
      expiresAtIso
    );

    for (let index = 0; index < normalizedQuantity; index += 1) {
      await db.run(
        `INSERT INTO reminders (batch_id, store_id, product_id, expires_at, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        batchInsert.lastID,
        normalizedStoreId,
        normalizedProductId,
        expiresAtIso
      );
    }

    await db.exec('COMMIT');

    const batch = await db.get(
      `SELECT id,
              store_id AS storeId,
              product_id AS productId,
              quantity,
              printed_at AS printedAt,
              expires_at AS expiresAt,
              created_at AS createdAt
       FROM batches
       WHERE id = ?`,
      batchInsert.lastID
    );

    return {
      batch,
      remindersCreated: normalizedQuantity
    };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

function normalizeReminderStatus(status) {
  const normalized = String(status || 'expiring').trim().toLowerCase();
  if (normalized !== 'expiring' && normalized !== 'expired' && normalized !== 'all') {
    throw new Error('status must be expiring, expired, or all');
  }
  return normalized;
}

async function listStoreReminders(db, { storeId, status = 'expiring', thresholdDays = 2 }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedStatus = normalizeReminderStatus(status);
  const normalizedThresholdDays = Number(thresholdDays);

  if (!Number.isInteger(normalizedThresholdDays) || normalizedThresholdDays < 0) {
    throw new Error('thresholdDays must be a non-negative integer');
  }

  const params = [normalizedStoreId];
  let statusSql = '';

  if (normalizedStatus === 'expired') {
    statusSql = `AND datetime(r.expires_at) < datetime('now')`;
  } else if (normalizedStatus === 'expiring') {
    statusSql = `AND datetime(r.expires_at) >= datetime('now')
                 AND datetime(r.expires_at) <= datetime('now', ?)`;
    params.push(`+${normalizedThresholdDays} days`);
  }

  return db.all(
    `SELECT r.id,
            r.batch_id AS batchId,
            r.store_id AS storeId,
            r.product_id AS productId,
            p.name AS productName,
            p.shelf_life_days AS shelfLifeDays,
            r.expires_at AS expiresAt,
            r.status,
            r.handled_at AS handledAt,
            r.created_at AS createdAt
     FROM reminders r
     JOIN products p ON p.id = r.product_id
     WHERE r.store_id = ?
       AND r.handled_at IS NULL
       ${statusSql}
     ORDER BY datetime(r.expires_at) ASC, r.id ASC`,
    ...params
  );
}

async function handleReminder(db, { storeId, reminderId, reason, note }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedReminderId = requirePositiveInteger(reminderId, 'reminderId');
  const normalizedReason = String(reason || '')
    .trim()
    .toLowerCase();
  const normalizedNote = String(note || '').trim() || null;

  if (!HANDLING_REASONS.includes(normalizedReason)) {
    throw new Error('reason must be one of discarded, sold, transferred');
  }

  const reminder = await db.get(
    `SELECT id, store_id AS storeId, product_id AS productId, handled_at AS handledAt
     FROM reminders
     WHERE id = ? AND store_id = ?`,
    normalizedReminderId,
    normalizedStoreId
  );

  if (!reminder) {
    throw new Error('Reminder not found');
  }
  if (reminder.handledAt) {
    throw new Error('Reminder already handled');
  }

  const handledAt = nowIso();

  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run(
      `UPDATE reminders
       SET status = 'handled', handled_at = ?
       WHERE id = ?`,
      handledAt,
      normalizedReminderId
    );

    await db.run(
      `INSERT INTO handling_logs (reminder_id, store_id, product_id, reason, note, handled_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      normalizedReminderId,
      normalizedStoreId,
      reminder.productId,
      normalizedReason,
      normalizedNote,
      handledAt
    );

    await db.exec('COMMIT');

    return db.get(
      `SELECT id,
              batch_id AS batchId,
              store_id AS storeId,
              product_id AS productId,
              expires_at AS expiresAt,
              status,
              handled_at AS handledAt
       FROM reminders
       WHERE id = ?`,
      normalizedReminderId
    );
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function listExpiredHandlingReport(db) {
  return db.all(
    `SELECT s.id AS storeId,
            s.name AS storeName,
            p.id AS productId,
            p.name AS productName,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expiredTotalCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS expiredHandledCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NULL THEN 1 ELSE 0 END) AS expiredUnhandledCount
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     JOIN products p ON p.id = r.product_id
     GROUP BY s.id, p.id
     HAVING SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) > 0
     ORDER BY s.id ASC, p.id ASC`
  );
}

module.exports = {
  HANDLING_REASONS,
  LABEL_LANGUAGE_BILINGUAL,
  LABEL_LANGUAGE_SINGLE,
  closeDb,
  consumeBindingCode,
  createBatchWithReminders,
  createBindingCode,
  createBrand,
  createDb,
  createProduct,
  createStore,
  ensureAdminUser,
  getStoreById,
  getUserByEmail,
  handleReminder,
  listAdminUsers,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listProducts,
  listStores,
  listStoreProducts,
  listStoreReminders,
  updateStorePrinterSettings
};

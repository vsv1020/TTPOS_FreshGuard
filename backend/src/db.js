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

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT,
  actor_id TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS label_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  width_mm INTEGER NOT NULL DEFAULT 60,
  height_mm INTEGER NOT NULL DEFAULT 40,
  dpi INTEGER NOT NULL DEFAULT 200,
  body_template TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stores_brand ON stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_binding_codes_store ON binding_codes(store_id);
CREATE INDEX IF NOT EXISTS idx_reminders_store_expires ON reminders(store_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_store_staff_store ON store_staff(store_id);
CREATE INDEX IF NOT EXISTS idx_label_templates_brand ON label_templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_reminders_batch ON reminders(batch_id);
CREATE INDEX IF NOT EXISTS idx_reminders_store_status_expires ON reminders(store_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_handling_logs_store_handled ON handling_logs(store_id, handled_at);
CREATE INDEX IF NOT EXISTS idx_handling_logs_reminder ON handling_logs(reminder_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_batches_store_product ON batches(store_id, product_id);
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

// Normalizes list pagination params. Returns null when no limit is requested
// (callers keep the legacy full-array behavior), otherwise { limit, offset }.
function normalizePagination({ limit, offset } = {}) {
  if (limit == null || limit === '') {
    return null;
  }
  const normalizedLimit = Number(limit);
  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
    throw new Error('limit must be a positive integer');
  }
  let normalizedOffset = 0;
  if (offset != null && offset !== '') {
    normalizedOffset = Number(offset);
    if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
      throw new Error('offset must be a non-negative integer');
    }
  }
  return { limit: normalizedLimit, offset: normalizedOffset };
}

function likeParam(q) {
  return `%${String(q).trim()}%`;
}

function normalizeLabelLanguage(labelLanguage) {
  const value = String(labelLanguage || LABEL_LANGUAGE_SINGLE).trim().toLowerCase();
  if (value !== LABEL_LANGUAGE_SINGLE && value !== LABEL_LANGUAGE_BILINGUAL) {
    throw new Error('labelLanguage must be single or bilingual');
  }
  return value;
}

function getProductLabelLanguages(product) {
  const languages = [String(product.primaryLanguage || 'en').trim().toLowerCase()].filter(Boolean);
  if (product.labelLanguage === LABEL_LANGUAGE_BILINGUAL && product.secondaryLanguage) {
    languages.push(String(product.secondaryLanguage).trim().toLowerCase());
  }
  return languages;
}

function renderLabelTemplate({
  template,
  productName,
  batchId,
  printedAt,
  expiresAt,
  storeName,
  languages,
  allergens,
  storageConditions,
  barcodeData,
  opened
}) {
  // Clear multi-line label layout closer to a real printed shelf-life label.
  // The leading keyed lines (Store / Product / Batch ID / Languages) are kept
  // verbatim so existing label consumers and tests continue to match.
  const lines = [];

  lines.push('=== FreshGuard Label ===');
  if (opened) {
    lines.push('** OPENED / 已开封 **');
  }
  lines.push(`Store: ${storeName}`);
  lines.push(`Product: ${productName}`);
  lines.push(`Batch ID: ${batchId}`);
  lines.push(`Template: ${template}`);
  lines.push(`Languages: ${languages.join(', ')}`);
  lines.push('------------------------');
  lines.push(`Printed At: ${printedAt}`);
  lines.push(`Expires At: ${expiresAt}`);

  const allergensText = String(allergens || '').trim();
  if (allergensText) {
    lines.push(`过敏原: ${allergensText}`);
  }
  const storageText = String(storageConditions || '').trim();
  if (storageText) {
    lines.push(`存储: ${storageText}`);
  }

  lines.push('------------------------');
  if (template === LABEL_LANGUAGE_BILINGUAL) {
    lines.push(`Primary Name [${languages[0]}]: ${productName}`);
    lines.push(`Secondary Name [${languages[1] || ''}]: ${productName}`);
  } else {
    lines.push(`Name [${languages[0] || 'en'}]: ${productName}`);
  }

  const barcodeText = String(barcodeData || '').trim();
  if (barcodeText) {
    lines.push('------------------------');
    lines.push(`Barcode: ${barcodeText}`);
  }

  return lines.join('\n');
}

function renderLabelFromTemplate(bodyTemplate, fields = {}) {
  // Replace {{placeholder}} tokens with the matching field value.
  // Missing values render as an empty string.
  return String(bodyTemplate || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = fields[key];
    return value == null ? '' : String(value);
  });
}

function getStorePrinterSettings(store) {
  return {
    printerName: store.printerName || null,
    printerModel: store.printerModel || null,
    printerAddress: store.printerAddress || null,
    printerPort: store.printerPort ?? null,
    printerDpi: store.printerDpi ?? null,
    labelWidthMm: store.labelWidthMm ?? null
  };
}

function generateBindingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function createDb(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(SCHEMA_SQL);

  // Idempotent migration: add brand_id to users if it doesn't exist yet
  const userColumns = await db.all("PRAGMA table_info(users)");
  const hasBrandId = userColumns.some((col) => col.name === 'brand_id');
  if (!hasBrandId) {
    await db.exec('ALTER TABLE users ADD COLUMN brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL');
  }

  // Idempotent migration: add new product columns for existing databases.
  // PRAGMA table_info returns rows: {cid, name, type, notnull, dflt_value, pk}
  const productColumns = await db.all('PRAGMA table_info(products)');
  const productColNames = new Set(productColumns.map((col) => col.name));
  if (!productColNames.has('is_active')) {
    await db.exec('ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1');
  }
  if (!productColNames.has('allergens')) {
    await db.exec('ALTER TABLE products ADD COLUMN allergens TEXT');
  }
  if (!productColNames.has('storage_conditions')) {
    await db.exec('ALTER TABLE products ADD COLUMN storage_conditions TEXT');
  }
  if (!productColNames.has('opened_shelf_life_hours')) {
    await db.exec('ALTER TABLE products ADD COLUMN opened_shelf_life_hours INTEGER');
  }

  // Idempotent migration: add barcode_data and note to batches/reminders for traceability + PAO.
  const batchColumns = await db.all('PRAGMA table_info(batches)');
  if (!batchColumns.some((col) => col.name === 'barcode_data')) {
    await db.exec('ALTER TABLE batches ADD COLUMN barcode_data TEXT');
  }
  const reminderColumns = await db.all('PRAGMA table_info(reminders)');
  if (!reminderColumns.some((col) => col.name === 'note')) {
    await db.exec('ALTER TABLE reminders ADD COLUMN note TEXT');
  }

  // Idempotent migration: staff attribution columns (HACCP accountability).
  if (!reminderColumns.some((col) => col.name === 'staff_id')) {
    await db.exec('ALTER TABLE reminders ADD COLUMN staff_id INTEGER');
  }
  const handlingLogColumns = await db.all('PRAGMA table_info(handling_logs)');
  if (!handlingLogColumns.some((col) => col.name === 'staff_id')) {
    await db.exec('ALTER TABLE handling_logs ADD COLUMN staff_id INTEGER');
  }
  if (!batchColumns.some((col) => col.name === 'printed_by_staff_id')) {
    await db.exec('ALTER TABLE batches ADD COLUMN printed_by_staff_id INTEGER');
  }

  // Idempotent migration: brand-level reminder config (expiring threshold in days).
  const brandColumns = await db.all('PRAGMA table_info(brands)');
  if (!brandColumns.some((col) => col.name === 'reminder_threshold_days')) {
    await db.exec('ALTER TABLE brands ADD COLUMN reminder_threshold_days INTEGER');
  }

  // Idempotent migration: brand scope on audit logs so brand admins only read
  // their own brand's trail. Legacy rows stay NULL (visible to platform admins only).
  const auditColumns = await db.all('PRAGMA table_info(audit_logs)');
  if (!auditColumns.some((col) => col.name === 'brand_id')) {
    await db.exec('ALTER TABLE audit_logs ADD COLUMN brand_id INTEGER');
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_brand_created ON audit_logs(brand_id, created_at)');

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
    `SELECT id, email, password_hash, role, brand_id, created_at
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
            p.allergens,
            p.storage_conditions AS storageConditions,
            p.opened_shelf_life_hours AS openedShelfLifeHours,
            p.is_active AS isActive,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt
     FROM products p
     JOIN brands b ON b.id = p.brand_id
     WHERE p.id = ?`,
    productId
  );
}

function normalizeOpenedShelfLifeHours(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('openedShelfLifeHours must be a positive integer');
  }
  return parsed;
}

async function createProduct(
  db,
  {
    brandId,
    name,
    sku,
    shelfLifeDays,
    labelLanguage,
    primaryLanguage,
    secondaryLanguage,
    allergens,
    storageConditions,
    openedShelfLifeHours
  }
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

  const normalizedAllergens = String(allergens || '').trim() || null;
  const normalizedStorageConditions = String(storageConditions || '').trim() || null;
  const normalizedOpenedShelfLifeHours = normalizeOpenedShelfLifeHours(openedShelfLifeHours);

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
      secondary_language,
      allergens,
      storage_conditions,
      opened_shelf_life_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    normalizedBrandId,
    normalizedName,
    normalizedSku,
    normalizedShelfLifeDays,
    normalizedLabelLanguage,
    normalizedPrimaryLanguage,
    normalizedSecondaryLanguage,
    normalizedAllergens,
    normalizedStorageConditions,
    normalizedOpenedShelfLifeHours
  );

  return getProductById(db, result.lastID);
}

const PRODUCT_UPDATE_COLUMN_MAP = {
  name: 'name',
  sku: 'sku',
  shelfLifeDays: 'shelf_life_days',
  labelLanguage: 'label_language',
  primaryLanguage: 'primary_language',
  secondaryLanguage: 'secondary_language',
  allergens: 'allergens',
  storageConditions: 'storage_conditions',
  openedShelfLifeHours: 'opened_shelf_life_hours'
};

async function updateProduct(db, productId, fields = {}) {
  const normalizedProductId = requirePositiveInteger(productId, 'productId');

  const existing = await getProductById(db, normalizedProductId);
  if (!existing) {
    throw new Error('productId not found');
  }

  const assignments = [];
  const values = [];

  for (const [key, rawValue] of Object.entries(fields)) {
    const column = PRODUCT_UPDATE_COLUMN_MAP[key];
    if (!column || rawValue === undefined) {
      continue;
    }

    let value = rawValue;
    if (key === 'name') {
      value = String(rawValue || '').trim();
      if (!value) {
        throw new Error('Product name is required');
      }
    } else if (key === 'sku') {
      value = String(rawValue || '').trim() || null;
    } else if (key === 'shelfLifeDays') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('shelfLifeDays must be a positive integer');
      }
      value = parsed;
    } else if (key === 'labelLanguage') {
      value = normalizeLabelLanguage(rawValue);
    } else if (key === 'primaryLanguage') {
      value = String(rawValue || 'en').trim().toLowerCase();
    } else if (key === 'secondaryLanguage') {
      value = String(rawValue || '').trim().toLowerCase() || null;
    } else if (key === 'allergens') {
      value = String(rawValue || '').trim() || null;
    } else if (key === 'storageConditions') {
      value = String(rawValue || '').trim() || null;
    } else if (key === 'openedShelfLifeHours') {
      value = normalizeOpenedShelfLifeHours(rawValue);
    }

    assignments.push(`${column} = ?`);
    values.push(value);
  }

  if (assignments.length === 0) {
    return existing;
  }

  // Validate resulting bilingual invariant against the merged state.
  const effectiveLabelLanguage = fields.labelLanguage !== undefined
    ? normalizeLabelLanguage(fields.labelLanguage)
    : existing.labelLanguage;
  const effectiveSecondary = fields.secondaryLanguage !== undefined
    ? (String(fields.secondaryLanguage || '').trim().toLowerCase() || null)
    : existing.secondaryLanguage;
  if (effectiveLabelLanguage === LABEL_LANGUAGE_BILINGUAL && !effectiveSecondary) {
    throw new Error('secondaryLanguage is required for bilingual labels');
  }

  assignments.push('updated_at = ?');
  values.push(nowIso());
  values.push(normalizedProductId);

  await db.run(
    `UPDATE products SET ${assignments.join(', ')} WHERE id = ?`,
    ...values
  );

  return getProductById(db, normalizedProductId);
}

async function deleteProduct(db, productId) {
  const normalizedProductId = requirePositiveInteger(productId, 'productId');
  const existing = await getProductById(db, normalizedProductId);
  if (!existing) {
    throw new Error('productId not found');
  }

  await db.run(
    `UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?`,
    nowIso(),
    normalizedProductId
  );

  return getProductById(db, normalizedProductId);
}

async function listProducts(db, { brandId, includeInactive = false, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('p.brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (!includeInactive) {
    whereClauses.push('p.is_active = 1');
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(likeParam(q), likeParam(q));
  }

  const fromSql = `FROM products p
     JOIN brands b ON b.id = p.brand_id
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT p.id,
            p.brand_id AS brandId,
            b.name AS brandName,
            p.name,
            p.sku,
            p.shelf_life_days AS shelfLifeDays,
            p.label_language AS labelLanguage,
            p.primary_language AS primaryLanguage,
            p.secondary_language AS secondaryLanguage,
            p.allergens,
            p.storage_conditions AS storageConditions,
            p.opened_shelf_life_hours AS openedShelfLifeHours,
            p.is_active AS isActive,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt
     ${fromSql}
     ORDER BY p.id ASC`;

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

async function listStoreProducts(db, storeId, { q, limit, offset } = {}) {
  const store = await getStoreById(db, storeId);
  if (!store) {
    throw new Error('storeId not found');
  }

  return listProducts(db, { brandId: store.brandId, q, limit, offset });
}

async function createBatchWithReminders(db, { storeId, productId, quantity, printedAt, staffId }) {
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

  const normalizedStaffId = await assertStoreStaff(db, normalizedStoreId, staffId);

  const printedAtIso = printedAt ? new Date(printedAt).toISOString() : nowIso();
  const expiresAtIso = addDaysIso(printedAtIso, product.shelfLifeDays);

  await db.exec('BEGIN TRANSACTION');
  try {
    const batchInsert = await db.run(
      `INSERT INTO batches (store_id, product_id, quantity, printed_at, expires_at, printed_by_staff_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      normalizedStoreId,
      normalizedProductId,
      normalizedQuantity,
      printedAtIso,
      expiresAtIso,
      normalizedStaffId
    );

    // Deterministic, traceable barcode so a scan can be reversed to the batch.
    const barcodeData = `FG-${store.brandId}-${normalizedStoreId}-${batchInsert.lastID}`;
    await db.run(
      `UPDATE batches SET barcode_data = ? WHERE id = ?`,
      barcodeData,
      batchInsert.lastID
    );

    for (let index = 0; index < normalizedQuantity; index += 1) {
      await db.run(
        `INSERT INTO reminders (batch_id, store_id, product_id, expires_at, status, staff_id)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
        batchInsert.lastID,
        normalizedStoreId,
        normalizedProductId,
        expiresAtIso,
        normalizedStaffId
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
              barcode_data AS barcodeData,
              created_at AS createdAt
       FROM batches
       WHERE id = ?`,
      batchInsert.lastID
    );

    const languages = getProductLabelLanguages(product);
    const label = {
      template: product.labelLanguage,
      productName: product.name,
      batchId: batch.id,
      printedAt: batch.printedAt,
      expiresAt: batch.expiresAt,
      storeName: store.name,
      languages,
      allergens: product.allergens,
      storageConditions: product.storageConditions,
      barcodeData: batch.barcodeData,
      staffId: normalizedStaffId
    };

    const defaultTemplate = await getDefaultLabelTemplate(db, { brandId: store.brandId });
    const templateFields = buildLabelTemplateFields(label);
    const text = defaultTemplate && defaultTemplate.bodyTemplate
      ? renderLabelFromTemplate(defaultTemplate.bodyTemplate, templateFields)
      : renderLabelTemplate(label);

    return {
      batch,
      remindersCreated: normalizedQuantity,
      store,
      printerSettings: getStorePrinterSettings(store),
      label: {
        ...label,
        templateBody: defaultTemplate ? defaultTemplate.bodyTemplate : null,
        fields: templateFields,
        text
      }
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

async function listStoreReminders(db, { storeId, status = 'expiring', thresholdDays = null, q, limit, offset } = {}) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedStatus = normalizeReminderStatus(status);

  // When no explicit threshold is given, fall back to the brand-level reminder
  // config (reminder_threshold_days), then to the historical default of 1 day.
  let effectiveThresholdDays = thresholdDays;
  if (effectiveThresholdDays == null || effectiveThresholdDays === '') {
    const configRow = await db.get(
      `SELECT b.reminder_threshold_days AS thresholdDays
       FROM stores s
       JOIN brands b ON b.id = s.brand_id
       WHERE s.id = ?`,
      normalizedStoreId
    );
    effectiveThresholdDays = configRow?.thresholdDays != null ? configRow.thresholdDays : 1;
  }
  const normalizedThresholdDays = Number(effectiveThresholdDays);

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

  let qSql = '';
  if (q != null && String(q).trim()) {
    qSql = 'AND p.name LIKE ?';
    params.push(likeParam(q));
  }

  const fromSql = `FROM reminders r
     JOIN products p ON p.id = r.product_id
     WHERE r.store_id = ?
       AND r.handled_at IS NULL
       ${statusSql}
       ${qSql}`;
  // FIFO/FEFO: earliest-expiring unhandled reminder of each product is priority.
  const selectSql = `SELECT r.id,
            r.batch_id AS batchId,
            r.store_id AS storeId,
            r.product_id AS productId,
            p.name AS productName,
            p.shelf_life_days AS shelfLifeDays,
            r.expires_at AS expiresAt,
            r.status,
            r.handled_at AS handledAt,
            r.created_at AS createdAt,
            CASE WHEN datetime(r.expires_at) = (
              SELECT MIN(datetime(r2.expires_at))
              FROM reminders r2
              WHERE r2.store_id = r.store_id
                AND r2.product_id = r.product_id
                AND r2.handled_at IS NULL
            ) THEN 1 ELSE 0 END AS is_priority
     ${fromSql}
     ORDER BY datetime(r.expires_at) ASC, r.id ASC`;

  const toReminder = (row) => ({ ...row, is_priority: row.is_priority === 1 });

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    const rows = await db.all(selectSql, ...params);
    return rows.map(toReminder);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c ${fromSql}`, ...params);
  const rows = await db.all(
    `${selectSql} LIMIT ? OFFSET ?`,
    ...params,
    pagination.limit,
    pagination.offset
  );
  return {
    items: rows.map(toReminder),
    total: Number(totalRow?.c || 0),
    limit: pagination.limit,
    offset: pagination.offset
  };
}

async function handleReminder(db, { storeId, reminderId, reason, note, staffId }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedReminderId = requirePositiveInteger(reminderId, 'reminderId');
  const normalizedReason = String(reason || '')
    .trim()
    .toLowerCase();
  const normalizedNote = String(note || '').trim() || null;

  if (!HANDLING_REASONS.includes(normalizedReason)) {
    throw new Error('reason must be one of discarded, sold, transferred');
  }

  const normalizedStaffId = await assertStoreStaff(db, normalizedStoreId, staffId);

  const handledAt = nowIso();

  await db.exec('BEGIN TRANSACTION');
  try {
    // Read reminder inside transaction to avoid TOCTOU race
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

    // Optimistic lock: AND handled_at IS NULL ensures we win the race
    const updateResult = await db.run(
      `UPDATE reminders
       SET status = 'handled', handled_at = ?, staff_id = COALESCE(?, staff_id)
       WHERE id = ? AND handled_at IS NULL`,
      handledAt,
      normalizedStaffId,
      normalizedReminderId
    );

    if (updateResult.changes === 0) {
      throw new Error('Reminder already handled');
    }

    await db.run(
      `INSERT INTO handling_logs (reminder_id, store_id, product_id, reason, note, handled_at, staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      normalizedReminderId,
      normalizedStoreId,
      reminder.productId,
      normalizedReason,
      normalizedNote,
      handledAt,
      normalizedStaffId
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

async function openReminder(db, { storeId, reminderId, staffId }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedReminderId = requirePositiveInteger(reminderId, 'reminderId');
  const normalizedStaffId = await assertStoreStaff(db, normalizedStoreId, staffId);

  await db.exec('BEGIN TRANSACTION');
  try {
    const reminder = await db.get(
      `SELECT id, batch_id AS batchId, store_id AS storeId, product_id AS productId
       FROM reminders
       WHERE id = ? AND store_id = ?`,
      normalizedReminderId,
      normalizedStoreId
    );

    if (!reminder) {
      throw new Error('Reminder not found');
    }

    const product = await getProductById(db, reminder.productId);
    if (!product) {
      throw new Error('productId not found');
    }
    if (!product.openedShelfLifeHours) {
      throw new Error('product has no opened_shelf_life_hours configured');
    }

    const store = await getStoreById(db, normalizedStoreId);
    if (!store) {
      throw new Error('storeId not found');
    }

    const batch = await db.get(
      `SELECT id, barcode_data AS barcodeData, printed_at AS printedAt
       FROM batches
       WHERE id = ?`,
      reminder.batchId
    );

    const openedAtIso = nowIso();
    const expiresAtIso = new Date(
      Date.parse(openedAtIso) + product.openedShelfLifeHours * 60 * 60 * 1000
    ).toISOString();

    const insertResult = await db.run(
      `INSERT INTO reminders (batch_id, store_id, product_id, expires_at, status, note, staff_id)
       VALUES (?, ?, ?, ?, 'pending', 'opened', ?)`,
      reminder.batchId,
      normalizedStoreId,
      reminder.productId,
      expiresAtIso,
      normalizedStaffId
    );

    await db.exec('COMMIT');

    const newReminder = await db.get(
      `SELECT id,
              batch_id AS batchId,
              store_id AS storeId,
              product_id AS productId,
              expires_at AS expiresAt,
              status,
              note,
              handled_at AS handledAt,
              created_at AS createdAt
       FROM reminders
       WHERE id = ?`,
      insertResult.lastID
    );

    const languages = getProductLabelLanguages(product);
    const label = {
      template: product.labelLanguage,
      productName: product.name,
      batchId: reminder.batchId,
      printedAt: openedAtIso,
      expiresAt: expiresAtIso,
      storeName: store.name,
      languages,
      allergens: product.allergens,
      storageConditions: product.storageConditions,
      barcodeData: batch ? batch.barcodeData : null,
      opened: true,
      staffId: normalizedStaffId
    };

    const defaultTemplate = await getDefaultLabelTemplate(db, { brandId: store.brandId });
    const templateFields = buildLabelTemplateFields(label);
    const text = defaultTemplate && defaultTemplate.bodyTemplate
      ? renderLabelFromTemplate(defaultTemplate.bodyTemplate, templateFields)
      : renderLabelTemplate(label);

    return {
      reminder: newReminder,
      label: {
        ...label,
        templateBody: defaultTemplate ? defaultTemplate.bodyTemplate : null,
        fields: templateFields,
        text
      }
    };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

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

// ─── Feature C: Label template CRUD ──────────────────────────────────────────

async function getLabelTemplateById(db, templateId) {
  return db.get(
    `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
            created_at AS createdAt
     FROM label_templates
     WHERE id = ?`,
    requirePositiveInteger(templateId, 'templateId')
  );
}

async function getDefaultLabelTemplate(db, { brandId } = {}) {
  if (brandId == null) {
    return undefined;
  }
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  return db.get(
    `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
            created_at AS createdAt
     FROM label_templates
     WHERE brand_id = ? AND is_default = 1
     ORDER BY id DESC
     LIMIT 1`,
    normalizedBrandId
  );
}

async function createLabelTemplate(db, { brandId, name, widthMm, heightMm, dpi, bodyTemplate, isDefault }) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('Template name is required');
  }
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const makeDefault = isDefault ? 1 : 0;

  await db.exec('BEGIN TRANSACTION');
  try {
    if (makeDefault) {
      await db.run('UPDATE label_templates SET is_default = 0 WHERE brand_id = ?', normalizedBrandId);
    }
    const result = await db.run(
      `INSERT INTO label_templates (brand_id, name, width_mm, height_mm, dpi, body_template, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      normalizedBrandId,
      normalizedName,
      widthMm != null ? Number(widthMm) : 60,
      heightMm != null ? Number(heightMm) : 40,
      dpi != null ? Number(dpi) : 200,
      bodyTemplate != null ? String(bodyTemplate) : null,
      makeDefault
    );
    await db.exec('COMMIT');
    return getLabelTemplateById(db, result.lastID);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function listLabelTemplates(db, { brandId, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('name LIKE ?');
    params.push(likeParam(q));
  }

  const fromSql = `FROM label_templates
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
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

const LABEL_TEMPLATE_COLUMN_MAP = {
  name: 'name',
  widthMm: 'width_mm',
  heightMm: 'height_mm',
  dpi: 'dpi',
  bodyTemplate: 'body_template'
};

async function updateLabelTemplate(db, templateId, fields = {}) {
  const normalizedTemplateId = requirePositiveInteger(templateId, 'templateId');
  const existing = await getLabelTemplateById(db, normalizedTemplateId);
  if (!existing) {
    throw new Error('templateId not found');
  }

  await db.exec('BEGIN TRANSACTION');
  try {
    const assignments = [];
    const values = [];
    for (const [key, rawValue] of Object.entries(fields)) {
      const column = LABEL_TEMPLATE_COLUMN_MAP[key];
      if (!column || rawValue === undefined) {
        continue;
      }
      let value = rawValue;
      if (key === 'name') {
        value = String(rawValue || '').trim();
        if (!value) {
          throw new Error('Template name is required');
        }
      } else if (key === 'widthMm' || key === 'heightMm' || key === 'dpi') {
        value = Number(rawValue);
      } else if (key === 'bodyTemplate') {
        value = rawValue != null ? String(rawValue) : null;
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    if (fields.isDefault !== undefined) {
      if (fields.isDefault) {
        await db.run('UPDATE label_templates SET is_default = 0 WHERE brand_id = ?', existing.brandId);
        assignments.push('is_default = ?');
        values.push(1);
      } else {
        assignments.push('is_default = ?');
        values.push(0);
      }
    }

    if (assignments.length > 0) {
      values.push(normalizedTemplateId);
      await db.run(`UPDATE label_templates SET ${assignments.join(', ')} WHERE id = ?`, ...values);
    }
    await db.exec('COMMIT');
    return getLabelTemplateById(db, normalizedTemplateId);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function deleteLabelTemplate(db, templateId) {
  const normalizedTemplateId = requirePositiveInteger(templateId, 'templateId');
  const existing = await getLabelTemplateById(db, normalizedTemplateId);
  if (!existing) {
    throw new Error('templateId not found');
  }
  await db.run('DELETE FROM label_templates WHERE id = ?', normalizedTemplateId);
  return existing;
}

// Build the flat placeholder field map for a label object.
function buildLabelTemplateFields(label) {
  return {
    product_name: label.productName,
    expires_at: label.expiresAt,
    printed_at: label.printedAt,
    batch_id: label.batchId,
    store_name: label.storeName,
    barcode: label.barcodeData,
    allergens: label.allergens,
    storage: label.storageConditions,
    opened: label.opened ? 'OPENED' : ''
  };
}

// ─── Feature B: Dashboard aggregation (read-only, brand-scoped) ──────────────

function brandScopeClause(brandId, alias, params) {
  if (brandId == null) {
    return '';
  }
  params.push(requirePositiveInteger(brandId, 'brandId'));
  return `AND ${alias}.brand_id = ?`;
}

async function getDashboardSummary(db, { brandId } = {}) {
  const storeParams = [];
  const storeScope = brandScopeClause(brandId, 's', storeParams);

  const brandCountRow = brandId == null
    ? await db.get('SELECT COUNT(*) AS c FROM brands')
    : { c: (await getBrandById(db, brandId)) ? 1 : 0 };

  const productParams = [];
  const productScope = brandScopeClause(brandId, 'p', productParams);
  const countsRow = await db.get(
    `SELECT
        (SELECT COUNT(*) FROM stores s WHERE 1=1 ${storeScope}) AS storeCount,
        (SELECT COUNT(*) FROM products p WHERE 1=1 ${productScope}) AS productCount`,
    ...storeParams,
    ...productParams
  );

  // Single pass over the relevant reminders (pending ones plus the last 30 days)
  // instead of three separate COUNT scans.
  const reminderParams = [];
  const reminderScope = brandScopeClause(brandId, 's', reminderParams);
  const reminderRow = await db.get(
    `SELECT
        SUM(CASE WHEN r.handled_at IS NULL
                 AND datetime(r.expires_at) >= datetime('now')
                 AND datetime(r.expires_at) <= datetime('now', '+1 day') THEN 1 ELSE 0 END) AS todayExpiring,
        SUM(CASE WHEN r.handled_at IS NULL
                 AND datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS unhandledExpired,
        SUM(CASE WHEN datetime(r.expires_at) >= datetime('now', '-30 day')
                 AND datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS rateTotal,
        SUM(CASE WHEN datetime(r.expires_at) >= datetime('now', '-30 day')
                 AND datetime(r.expires_at) < datetime('now')
                 AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS rateHandled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE (r.handled_at IS NULL OR datetime(r.expires_at) >= datetime('now', '-30 day'))
       ${reminderScope}`,
    ...reminderParams
  );

  const total = Number(reminderRow?.rateTotal || 0);
  const handled = Number(reminderRow?.rateHandled || 0);
  const handledRate = total > 0 ? handled / total : 0;

  return {
    brands: Number(brandCountRow?.c || 0),
    stores: Number(countsRow?.storeCount || 0),
    products: Number(countsRow?.productCount || 0),
    todayExpiringCount: Number(reminderRow?.todayExpiring || 0),
    unhandledExpiredCount: Number(reminderRow?.unhandledExpired || 0),
    handledRate
  };
}

async function getStoreExpiryRanking(db, { brandId, limit = 10 } = {}) {
  const params = [];
  const scope = brandScopeClause(brandId, 's', params);
  const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
  params.push(normalizedLimit);
  return db.all(
    `SELECT s.id AS storeId,
            s.name AS storeName,
            COUNT(r.id) AS count
     FROM stores s
     LEFT JOIN reminders r ON r.store_id = s.id
       AND r.handled_at IS NULL
       AND datetime(r.expires_at) <= datetime('now', '+1 day')
     WHERE 1=1 ${scope}
     GROUP BY s.id
     ORDER BY count DESC, s.id ASC
     LIMIT ?`,
    ...params
  );
}

async function getLossTrend(db, { brandId, days = 30 } = {}) {
  const normalizedDays = Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  const params = [];
  const scope = brandScopeClause(brandId, 's', params);
  params.push(`-${normalizedDays} day`);
  return db.all(
    `SELECT date(r.expires_at) AS date,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS handled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE 1=1 ${scope}
       AND datetime(r.expires_at) >= datetime('now', ?)
     GROUP BY date(r.expires_at)
     ORDER BY date(r.expires_at) ASC`,
    ...params
  );
}

async function getInspectionScoreTrend(db, { brandId, days = 30 } = {}) {
  const normalizedDays = Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  const params = [];
  const scope = brandScopeClause(brandId, 's', params);
  params.push(`-${normalizedDays} day`);
  return db.all(
    `SELECT date(COALESCE(i.completed_at, i.created_at)) AS date,
            AVG(
              CASE
                WHEN i.score_pct IS NOT NULL THEN i.score_pct
                WHEN i.max_score > 0 THEN (i.total_score * 100.0 / i.max_score)
                ELSE NULL
              END
            ) AS avgScore,
            COUNT(*) AS count
     FROM inspections i
     JOIN stores s ON s.id = i.store_id
     WHERE 1=1 ${scope}
       AND datetime(COALESCE(i.completed_at, i.created_at)) >= datetime('now', ?)
     GROUP BY date(COALESCE(i.completed_at, i.created_at))
     ORDER BY date(COALESCE(i.completed_at, i.created_at)) ASC`,
    ...params
  );
}

function recordAudit(db, { actorType, actorId, action, targetType, targetId, detail, ip, brandId }) {
  // Audit logging must never break the main flow; swallow any error.
  return db
    .run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, detail, ip, brand_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      actorType != null ? String(actorType) : null,
      actorId != null ? String(actorId) : null,
      action != null ? String(action) : null,
      targetType != null ? String(targetType) : null,
      targetId != null ? String(targetId) : null,
      detail != null ? String(detail) : null,
      ip != null ? String(ip) : null,
      brandId != null ? Number(brandId) : null,
      nowIso()
    )
    .catch((error) => {
      console.warn('recordAudit failed:', error?.message || error);
    });
}

async function listAuditLogs(db, { brandId, actor, action, from, to, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (actor != null && String(actor).trim()) {
    whereClauses.push('actor_id = ?');
    params.push(String(actor).trim());
  }
  if (action != null && String(action).trim()) {
    whereClauses.push('action = ?');
    params.push(String(action).trim());
  }
  if (from != null && String(from).trim()) {
    whereClauses.push('datetime(created_at) >= datetime(?)');
    params.push(String(from).trim());
  }
  if (to != null && String(to).trim()) {
    whereClauses.push('datetime(created_at) <= datetime(?)');
    params.push(String(to).trim());
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(actor_id LIKE ? OR action LIKE ? OR target_type LIKE ? OR target_id LIKE ? OR detail LIKE ?)');
    params.push(likeParam(q), likeParam(q), likeParam(q), likeParam(q), likeParam(q));
  }

  const fromSql = `FROM audit_logs
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id,
            actor_type AS actorType,
            actor_id AS actorId,
            action,
            target_type AS targetType,
            target_id AS targetId,
            detail,
            ip,
            brand_id AS brandId,
            created_at AS createdAt
     ${fromSql}
     ORDER BY id DESC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    // Legacy behavior: capped array response.
    return db.all(`${selectSql} LIMIT ?`, ...params, 100);
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

async function listExpiredHandlingReport(db, { brandId, startDate, endDate, q, limit, offset } = {}) {
  const params = [];
  const whereClauses = [];

  if (brandId != null) {
    const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
    whereClauses.push('s.brand_id = ?');
    params.push(normalizedBrandId);
  }

  // Optional date range filters expired reminders by handled_at (when handled)
  // falling back to the batch printed_at for unhandled ones.
  const effectiveDate = "COALESCE(r.handled_at, bt.printed_at)";
  if (startDate != null && String(startDate).trim()) {
    whereClauses.push(`datetime(${effectiveDate}) >= datetime(?)`);
    params.push(String(startDate).trim());
  }
  if (endDate != null && String(endDate).trim()) {
    whereClauses.push(`datetime(${effectiveDate}) <= datetime(?)`);
    params.push(String(endDate).trim());
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(s.name LIKE ? OR p.name LIKE ?)');
    params.push(likeParam(q), likeParam(q));
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // FEFO: report rows ordered by the earliest expiry first.
  const selectSql = `SELECT s.id AS storeId,
            s.name AS storeName,
            p.id AS productId,
            p.name AS productName,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expiredTotalCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS expiredHandledCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NULL THEN 1 ELSE 0 END) AS expiredUnhandledCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'discarded' THEN 1 ELSE 0 END) AS discardedCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'sold' THEN 1 ELSE 0 END) AS soldCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'transferred' THEN 1 ELSE 0 END) AS transferredCount
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     JOIN products p ON p.id = r.product_id
     JOIN batches bt ON bt.id = r.batch_id
     LEFT JOIN handling_logs hl ON hl.reminder_id = r.id
     ${whereSql}
     GROUP BY s.id, p.id
     HAVING SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) > 0
     ORDER BY MIN(datetime(r.expires_at)) ASC, s.id ASC, p.id ASC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    return db.all(selectSql, ...params);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM (${selectSql})`, ...params);
  const items = await db.all(
    `${selectSql} LIMIT ? OFFSET ?`,
    ...params,
    pagination.limit,
    pagination.offset
  );
  return { items, total: Number(totalRow?.c || 0), limit: pagination.limit, offset: pagination.offset };
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

// ─── P0-1: Proactive reminder scan (cron) ────────────────────────────────────
// Reminders are created with each batch at print time, so the periodic scan is
// a safety net + status refresher. All steps are idempotent:
//   1. Backfill reminders for batches that lost them (zero rows for the batch).
//   2. Mark unhandled, already-expired reminders as 'overdue'.
//   3. Mark unhandled reminders inside the brand expiring window (in days,
//      from brands.reminder_threshold_days, default 1) as 'expiring'.
// Status only moves forward (pending -> expiring -> overdue), never repeats,
// and list queries filter on handled_at/expires_at so nothing breaks.
async function runReminderScan(db) {
  const orphanBatches = await db.all(
    `SELECT b.id,
            b.store_id AS storeId,
            b.product_id AS productId,
            b.quantity,
            b.expires_at AS expiresAt,
            b.printed_by_staff_id AS staffId
     FROM batches b
     WHERE NOT EXISTS (SELECT 1 FROM reminders r WHERE r.batch_id = b.id)`
  );

  let backfilled = 0;
  for (const batch of orphanBatches) {
    for (let index = 0; index < batch.quantity; index += 1) {
      await db.run(
        `INSERT INTO reminders (batch_id, store_id, product_id, expires_at, status, staff_id)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
        batch.id,
        batch.storeId,
        batch.productId,
        batch.expiresAt,
        batch.staffId
      );
      backfilled += 1;
    }
  }

  const overdueResult = await db.run(
    `UPDATE reminders
     SET status = 'overdue'
     WHERE handled_at IS NULL
       AND status != 'overdue'
       AND datetime(expires_at) < datetime('now')`
  );

  const expiringResult = await db.run(
    `UPDATE reminders
     SET status = 'expiring'
     WHERE handled_at IS NULL
       AND status = 'pending'
       AND datetime(expires_at) >= datetime('now')
       AND datetime(expires_at) <= datetime('now', '+' || (
         SELECT COALESCE(b.reminder_threshold_days, 1)
         FROM stores s
         JOIN brands b ON b.id = s.brand_id
         WHERE s.id = reminders.store_id
       ) || ' days')`
  );

  return {
    backfilled,
    markedOverdue: Number(overdueResult.changes || 0),
    markedExpiring: Number(expiringResult.changes || 0)
  };
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
  createLabelTemplate,
  createProduct,
  createStore,
  createStoreStaff,
  deactivateStoreStaff,
  deleteLabelTemplate,
  deleteProduct,
  ensureAdminUser,
  getBrandReminderConfig,
  getDashboardSummary,
  getDefaultLabelTemplate,
  getInspectionScoreTrend,
  getLabelTemplateById,
  getLossTrend,
  getProductById,
  getStoreById,
  getStoreExpiryRanking,
  getStoreStaffById,
  getUserByEmail,
  handleReminder,
  listAdminUsers,
  listAuditLogs,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listLabelTemplates,
  listProducts,
  listStores,
  listStoreProducts,
  listStoreReminders,
  listStoreStaff,
  openReminder,
  recordAudit,
  renderLabelFromTemplate,
  renderLabelTemplate,
  runReminderScan,
  updateBrandReminderConfig,
  updateLabelTemplate,
  updateProduct,
  updateStoreStaff,
  updateStorePrinterSettings,
  verifyStoreStaffPin
};

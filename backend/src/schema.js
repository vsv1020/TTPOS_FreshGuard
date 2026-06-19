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
  reason TEXT NOT NULL CHECK (reason IN ('discarded', 'sold', 'transferred', 'discounted')),
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

CREATE TABLE IF NOT EXISTS pin_attempts (
  store_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, staff_id)
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

CREATE TABLE IF NOT EXISTS erp_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  default_label_language TEXT NOT NULL DEFAULT 'single' CHECK (default_label_language IN ('single', 'bilingual')),
  default_primary_language TEXT NOT NULL DEFAULT 'th',
  default_secondary_language TEXT,
  last_sync_at TEXT,
  last_sync_status TEXT,
  last_sync_detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS erp_category_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  item_group TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_id, item_group),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_erp_category_selections_brand ON erp_category_selections(brand_id);
`;

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

  // Idempotent migration: RBAC role split + disabled flag on admin accounts.
  // Legacy 'admin' rows become platform_admin (no brand) or brand_admin.
  if (!userColumns.some((col) => col.name === 'disabled')) {
    await db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  }
  await db.run(
    `UPDATE users
     SET role = CASE WHEN brand_id IS NULL THEN 'platform_admin' ELSE 'brand_admin' END
     WHERE role = 'admin'`
  );

  // Idempotent migration: store token versioning for token revocation.
  const storeColumns = await db.all('PRAGMA table_info(stores)');
  if (!storeColumns.some((col) => col.name === 'token_version')) {
    await db.exec('ALTER TABLE stores ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
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
  // P1-3: per-unit cost used by the waste report (nullable; missing costs
  // count as 0 in discardAmount and are surfaced via missingCostCount).
  if (!productColNames.has('cost_price')) {
    await db.exec('ALTER TABLE products ADD COLUMN cost_price REAL');
  }
  // P2-2: four-color coding (red/blue/green/yellow), nullable.
  if (!productColNames.has('color_code')) {
    await db.exec('ALTER TABLE products ADD COLUMN color_code TEXT');
  }
  // ERP sync: external reference (ERP item_code) + origin marker. Only rows
  // with source='erp' are touched by the sync; manual rows are never adopted.
  if (!productColNames.has('external_ref')) {
    await db.exec('ALTER TABLE products ADD COLUMN external_ref TEXT');
  }
  if (!productColNames.has('source')) {
    await db.exec("ALTER TABLE products ADD COLUMN source TEXT DEFAULT 'manual'");
  }
  // One ERP item maps to at most one product per brand. Partial index keeps the
  // constraint off manual rows (external_ref IS NULL).
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_products_brand_extref ON products(brand_id, external_ref) WHERE external_ref IS NOT NULL'
  );

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

  // P2-3: brand-level promo rules (JSON array, see normalizePromoRules).
  if (!brandColumns.some((col) => col.name === 'promo_rules')) {
    await db.exec('ALTER TABLE brands ADD COLUMN promo_rules TEXT');
  }

  // P2-3 idempotent migration: existing databases were created with a CHECK
  // that excludes the new 'discounted' handling reason. SQLite cannot alter a
  // CHECK constraint, so rebuild the table once (detected via sqlite_master).
  const handlingLogsDdl = await db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'handling_logs'`
  );
  if (handlingLogsDdl && !String(handlingLogsDdl.sql).includes('discounted')) {
    const oldCols = (await db.all('PRAGMA table_info(handling_logs)'))
      .map((col) => col.name)
      .join(', ');
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN TRANSACTION');
    await db.exec('ALTER TABLE handling_logs RENAME TO _handling_logs_old');
    await db.exec(`
      CREATE TABLE handling_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reminder_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('discarded', 'sold', 'transferred', 'discounted')),
        note TEXT,
        handled_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        staff_id INTEGER,
        FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    await db.exec(`INSERT INTO handling_logs (${oldCols}) SELECT ${oldCols} FROM _handling_logs_old`);
    await db.exec('DROP TABLE _handling_logs_old');
    await db.exec('COMMIT');
    await db.exec('PRAGMA foreign_keys = ON');
    // The rename+drop above took the old table's indexes with it.
    await db.exec('CREATE INDEX IF NOT EXISTS idx_handling_logs_store_handled ON handling_logs(store_id, handled_at)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_handling_logs_reminder ON handling_logs(reminder_id)');
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

module.exports = {
  SCHEMA_SQL,
  createDb,
  closeDb
};

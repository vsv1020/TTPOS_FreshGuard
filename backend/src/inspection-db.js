/**
 * Inspection module database operations.
 * Templates CRUD, Inspections, Issues.
 */

const INSPECTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS inspection_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  total_score INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS check_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'score' CHECK (type IN ('score', 'yes_no', 'text', 'photo')),
  max_score INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  inspector_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewed')),
  total_score INTEGER DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inspection_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  check_item_id INTEGER NOT NULL,
  score INTEGER,
  value TEXT,
  photo_url TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  FOREIGN KEY (check_item_id) REFERENCES check_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER,
  store_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  assigned_to INTEGER,
  due_date TEXT,
  resolution_note TEXT,
  photos TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE SET NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);
`;

async function initInspectionSchema(db) {
  await db.exec(INSPECTION_SCHEMA);
}

// ─── Templates ───────────────────────────────────────────

async function createTemplate(db, { brandId, name, description, category, totalScore }) {
  if (!brandId || !name) throw new Error('brandId and name are required');
  const result = await db.run(
    `INSERT INTO inspection_templates (brand_id, name, description, category, total_score)
     VALUES (?, ?, ?, ?, ?)`,
    [brandId, name, description || null, category || null, totalScore || 100]
  );
  return db.get('SELECT * FROM inspection_templates WHERE id = ?', [result.lastID]);
}

async function listTemplates(db, { brandId, activeOnly = true } = {}) {
  let sql = 'SELECT * FROM inspection_templates WHERE 1=1';
  const params = [];
  if (brandId) { sql += ' AND brand_id = ?'; params.push(brandId); }
  if (activeOnly) { sql += ' AND is_active = 1'; }
  sql += ' ORDER BY created_at DESC';
  return db.all(sql, params);
}

async function getTemplate(db, id) {
  const template = await db.get('SELECT * FROM inspection_templates WHERE id = ?', [id]);
  if (!template) throw new Error('Template not found');
  const checkItems = await db.all(
    'SELECT * FROM check_items WHERE template_id = ? ORDER BY sort_order ASC',
    [id]
  );
  return { ...template, checkItems };
}

async function updateTemplate(db, id, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (['name', 'description', 'category', 'total_score', 'is_active'].includes(key) && val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) throw new Error('No valid fields to update');
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);
  await db.run(`UPDATE inspection_templates SET ${fields.join(', ')} WHERE id = ?`, values);
  return db.get('SELECT * FROM inspection_templates WHERE id = ?', [id]);
}

async function deleteTemplate(db, id) {
  const result = await db.run('DELETE FROM inspection_templates WHERE id = ?', [id]);
  if (result.changes === 0) throw new Error('Template not found');
}

// ─── Check Items ─────────────────────────────────────────

async function addCheckItem(db, { templateId, name, description, type, maxScore, sortOrder, isRequired }) {
  if (!templateId || !name) throw new Error('templateId and name are required');
  const result = await db.run(
    `INSERT INTO check_items (template_id, name, description, type, max_score, sort_order, is_required)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [templateId, name, description || null, type || 'score', maxScore || 10, sortOrder || 0, isRequired !== false ? 1 : 0]
  );
  return db.get('SELECT * FROM check_items WHERE id = ?', [result.lastID]);
}

async function updateCheckItem(db, id, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (['name', 'description', 'type', 'max_score', 'sort_order', 'is_required'].includes(key) && val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) throw new Error('No valid fields to update');
  values.push(id);
  await db.run(`UPDATE check_items SET ${fields.join(', ')} WHERE id = ?`, values);
  return db.get('SELECT * FROM check_items WHERE id = ?', [id]);
}

async function deleteCheckItem(db, id) {
  const result = await db.run('DELETE FROM check_items WHERE id = ?', [id]);
  if (result.changes === 0) throw new Error('Check item not found');
}

// ─── Inspections ─────────────────────────────────────────

async function createInspection(db, { templateId, storeId, inspectorId, remarks }) {
  if (!templateId || !storeId || !inspectorId) {
    throw new Error('templateId, storeId, and inspectorId are required');
  }
  const result = await db.run(
    `INSERT INTO inspections (template_id, store_id, inspector_id, remarks)
     VALUES (?, ?, ?, ?)`,
    [templateId, storeId, inspectorId, remarks || null]
  );
  return db.get('SELECT * FROM inspections WHERE id = ?', [result.lastID]);
}

async function submitInspectionResults(db, { inspectionId, results }) {
  if (!inspectionId || !Array.isArray(results)) {
    throw new Error('inspectionId and results array are required');
  }

  let totalScore = 0;
  for (const r of results) {
    await db.run(
      `INSERT INTO inspection_results (inspection_id, check_item_id, score, value, photo_url, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [inspectionId, r.checkItemId, r.score || 0, r.value || null, r.photoUrl || null, r.note || null]
    );
    totalScore += r.score || 0;
  }

  await db.run(
    `UPDATE inspections SET status = 'submitted', total_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [totalScore, inspectionId]
  );

  return db.get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
}

async function listInspections(db, { storeId, templateId, status, limit = 50 } = {}) {
  let sql = `SELECT i.*, it.name as template_name, s.name as store_name
             FROM inspections i
             LEFT JOIN inspection_templates it ON i.template_id = it.id
             LEFT JOIN stores s ON i.store_id = s.id
             WHERE 1=1`;
  const params = [];
  if (storeId) { sql += ' AND i.store_id = ?'; params.push(storeId); }
  if (templateId) { sql += ' AND i.template_id = ?'; params.push(templateId); }
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  sql += ' ORDER BY i.created_at DESC LIMIT ?';
  params.push(limit);
  return db.all(sql, params);
}

async function getInspection(db, id) {
  const inspection = await db.get(
    `SELECT i.*, it.name as template_name, s.name as store_name
     FROM inspections i
     LEFT JOIN inspection_templates it ON i.template_id = it.id
     LEFT JOIN stores s ON i.store_id = s.id
     WHERE i.id = ?`,
    [id]
  );
  if (!inspection) throw new Error('Inspection not found');
  const results = await db.all(
    `SELECT ir.*, ci.name as check_item_name, ci.type, ci.max_score
     FROM inspection_results ir
     LEFT JOIN check_items ci ON ir.check_item_id = ci.id
     WHERE ir.inspection_id = ?
     ORDER BY ci.sort_order ASC`,
    [id]
  );
  return { ...inspection, results };
}

// ─── Issues ──────────────────────────────────────────────

async function createIssue(db, { inspectionId, storeId, title, description, severity, assignedTo, dueDate }) {
  if (!storeId || !title) throw new Error('storeId and title are required');
  const result = await db.run(
    `INSERT INTO issues (inspection_id, store_id, title, description, severity, assigned_to, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inspectionId || null, storeId, title, description || null, severity || 'medium', assignedTo || null, dueDate || null]
  );
  return db.get('SELECT * FROM issues WHERE id = ?', [result.lastID]);
}

async function updateIssue(db, id, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (['status', 'assigned_to', 'due_date', 'resolution_note', 'severity'].includes(key) && val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) throw new Error('No valid fields to update');
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);
  await db.run(`UPDATE issues SET ${fields.join(', ')} WHERE id = ?`, values);
  return db.get('SELECT * FROM issues WHERE id = ?', [id]);
}

async function listIssues(db, { storeId, status, severity, limit = 50 } = {}) {
  let sql = `SELECT issues.*, s.name as store_name
             FROM issues
             LEFT JOIN stores s ON issues.store_id = s.id
             WHERE 1=1`;
  const params = [];
  if (storeId) { sql += ' AND issues.store_id = ?'; params.push(storeId); }
  if (status) { sql += ' AND issues.status = ?'; params.push(status); }
  if (severity) { sql += ' AND issues.severity = ?'; params.push(severity); }
  sql += ' ORDER BY issues.created_at DESC LIMIT ?';
  params.push(limit);
  return db.all(sql, params);
}

module.exports = {
  initInspectionSchema,
  // Templates
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  // Check Items
  addCheckItem,
  updateCheckItem,
  deleteCheckItem,
  // Inspections
  createInspection,
  submitInspectionResults,
  listInspections,
  getInspection,
  // Issues
  createIssue,
  updateIssue,
  listIssues,
};

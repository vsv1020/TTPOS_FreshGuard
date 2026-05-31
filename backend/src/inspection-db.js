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
  inspector_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'reviewed', 'completed')),
  type TEXT DEFAULT 'inspection',
  max_score INTEGER DEFAULT 0,
  grade TEXT,
  score_pct REAL,
  completed_at TEXT,
  total_score INTEGER DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inspection_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  check_item_id INTEGER NOT NULL,
  score INTEGER,
  value TEXT,
  photo_url TEXT,
  note TEXT,
  max_score_snapshot INTEGER,
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

  // Idempotent migrations for existing databases that were created before schema updates.
  // PRAGMA table_info returns rows: {cid, name, type, notnull, dflt_value, pk}
  const inspCols = await db.all('PRAGMA table_info(inspections)');
  const inspColNames = new Set(inspCols.map(c => c.name));

  if (!inspColNames.has('type')) {
    await db.run("ALTER TABLE inspections ADD COLUMN type TEXT DEFAULT 'inspection'");
  }
  if (!inspColNames.has('max_score')) {
    await db.run('ALTER TABLE inspections ADD COLUMN max_score INTEGER DEFAULT 0');
  }
  if (!inspColNames.has('grade')) {
    await db.run('ALTER TABLE inspections ADD COLUMN grade TEXT');
  }
  if (!inspColNames.has('score_pct')) {
    await db.run('ALTER TABLE inspections ADD COLUMN score_pct REAL');
  }
  if (!inspColNames.has('completed_at')) {
    await db.run('ALTER TABLE inspections ADD COLUMN completed_at TEXT');
  }

  // Migration: if inspector_id is NOT NULL (old schema), recreate inspections table
  // to make it nullable so self-check records (with no linked user) can be inserted.
  // Use explicit column list so the copy works regardless of which optional columns
  // exist in the old table (they all have defaults in the new table).
  const inspectorCol = inspCols.find(c => c.name === 'inspector_id');
  if (inspectorCol && inspectorCol.notnull === 1) {
    // Build the list of columns that exist in the OLD table (to copy only those).
    const oldColNames = inspCols.map(c => c.name).join(', ');
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN TRANSACTION');
    await db.exec('ALTER TABLE inspections RENAME TO _inspections_old');
    await db.exec(`
      CREATE TABLE inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        inspector_id INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'reviewed', 'completed')),
        type TEXT DEFAULT 'inspection',
        max_score INTEGER DEFAULT 0,
        grade TEXT,
        score_pct REAL,
        completed_at TEXT,
        total_score INTEGER DEFAULT 0,
        remarks TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
        FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await db.exec(`INSERT INTO inspections (${oldColNames}) SELECT ${oldColNames} FROM _inspections_old`);
    await db.exec('DROP TABLE _inspections_old');
    await db.exec('COMMIT');
    await db.exec('PRAGMA foreign_keys = ON');
  }

  const resCols = await db.all('PRAGMA table_info(inspection_results)');
  const resColNames = new Set(resCols.map(c => c.name));

  if (!resColNames.has('max_score_snapshot')) {
    await db.run('ALTER TABLE inspection_results ADD COLUMN max_score_snapshot INTEGER');
  }
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

// ─── Issue severity helper ────────────────────────────────

// Returns severity string if score is below threshold, null otherwise.
function _isssueSeverity(score, maxScore) {
  if (maxScore <= 0) return null;
  if (score === 0) return 'critical';
  if (score < maxScore * 0.4) return 'high';
  if (score < maxScore * 0.6) return 'medium';
  return null;
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

  // Guard against double-submission before opening transaction.
  const current = await db.get('SELECT status, store_id FROM inspections WHERE id = ?', [inspectionId]);
  if (!current) throw new Error('Inspection not found');
  if (current.status === 'submitted' || current.status === 'completed') {
    throw new Error('Inspection already submitted');
  }

  // Collect per-item scores for issue generation (after commit).
  const itemSnapshots = [];

  await db.exec('BEGIN TRANSACTION');
  try {
    let totalScore = 0;
    let totalMaxScore = 0;

    for (const r of results) {
      // Fetch max_score and name for this check item to clamp and snapshot.
      const item = await db.get('SELECT max_score, name FROM check_items WHERE id = ?', [r.checkItemId]);
      const itemMaxScore = item ? item.max_score : 0;
      const itemName = item ? item.name : String(r.checkItemId);
      // Clamp submitted score to [0, itemMaxScore].
      const clampedScore = Math.min(Math.max(r.score || 0, 0), itemMaxScore);

      await db.run(
        `INSERT INTO inspection_results
           (inspection_id, check_item_id, score, value, photo_url, note, max_score_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [inspectionId, r.checkItemId, clampedScore, r.value || null, r.photoUrl || null, r.note || null, itemMaxScore]
      );
      totalScore += clampedScore;
      totalMaxScore += itemMaxScore;
      itemSnapshots.push({ name: itemName, score: clampedScore, maxScore: itemMaxScore });
    }

    await db.run(
      `UPDATE inspections
       SET status = 'submitted', total_score = ?, max_score = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [totalScore, totalMaxScore, inspectionId]
    );

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  // Auto-generate issues for low-score items (after transaction committed).
  const storeId = current.store_id;
  for (const snap of itemSnapshots) {
    const severity = _isssueSeverity(snap.score, snap.maxScore);
    if (!severity) continue;
    await createIssue(db, {
      inspectionId,
      storeId,
      title: `Low score: ${snap.name}`,
      description: `Score ${snap.score}/${snap.maxScore} on inspection #${inspectionId}`,
      severity,
    }).catch(() => {}); // non-fatal
  }

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



// ─── Week 2: Self-Check Module ───────────────────────────

async function createSelfCheck(db, { storeId, templateId }) {
  if (!storeId || !templateId) throw new Error('storeId and templateId required');
  // inspector_id is NULL for store-initiated self-checks (no linked admin user).
  const result = await db.run(
    `INSERT INTO inspections (template_id, store_id, inspector_id, type, status, created_at)
     VALUES (?, ?, NULL, 'self_check', 'in_progress', datetime('now'))`,
    [templateId, storeId]
  );
  const id = result.lastID;
  return { id, templateId, storeId, type: 'self_check', status: 'in_progress' };
}

async function submitSelfCheckResults(db, { inspectionId, results, photos }) {
  const insp = await db.get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
  if (!insp) throw new Error('Inspection not found');
  if (insp.status === 'completed') throw new Error('Already submitted');

  let totalScore = 0;
  let maxScore = 0;
  const itemSnapshots = [];

  for (const r of results) {
    const item = await db.get('SELECT max_score, name FROM check_items WHERE id = ?', [r.checkItemId]);
    const itemMaxScore = item ? item.max_score : 0;
    const itemName = item ? item.name : String(r.checkItemId);
    // Clamp score to [0, itemMaxScore].
    const clampedScore = Math.min(Math.max(r.score || 0, 0), itemMaxScore);

    // Use AUTOINCREMENT — no manual id.
    await db.run(
      `INSERT OR REPLACE INTO inspection_results
         (inspection_id, check_item_id, score, note, photo_url, max_score_snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [inspectionId, r.checkItemId, clampedScore, r.note || '', r.photoUrl || '', itemMaxScore]
    );
    totalScore += clampedScore;
    maxScore += itemMaxScore;
    itemSnapshots.push({ name: itemName, score: clampedScore, maxScore: itemMaxScore });
  }

  // Calculate grade
  const pct = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';

  await db.run(
    `UPDATE inspections SET status = 'completed', total_score = ?, max_score = ?, grade = ?,
     score_pct = ?, completed_at = datetime('now') WHERE id = ?`,
    [totalScore, maxScore, grade, Math.round(pct * 10) / 10, inspectionId]
  );

  // Auto-generate issues for low-score items (after update committed).
  const storeId = insp.store_id;
  for (const snap of itemSnapshots) {
    const severity = _isssueSeverity(snap.score, snap.maxScore);
    if (!severity) continue;
    await createIssue(db, {
      inspectionId,
      storeId,
      title: `Low score: ${snap.name}`,
      description: `Score ${snap.score}/${snap.maxScore} on self-check #${inspectionId}`,
      severity,
    }).catch(() => {}); // non-fatal
  }

  return { inspectionId, totalScore, maxScore, pct: Math.round(pct * 10) / 10, grade };
}

// ─── Week 2: Scoring & Grading ───────────────────────────

async function getInspectionScorecard(db, inspectionId) {
  const insp = await db.get(
    `SELECT i.*, t.name as template_name, t.category
     FROM inspections i
     LEFT JOIN inspection_templates t ON t.id = i.template_id
     WHERE i.id = ?`,
    [inspectionId]
  );
  if (!insp) throw new Error('Inspection not found');

  const results = await db.all(
    `SELECT r.*, ci.name as item_name, ci.description as item_desc, ci.max_score, ci.sort_order
     FROM inspection_results r
     LEFT JOIN check_items ci ON ci.id = r.check_item_id
     WHERE r.inspection_id = ?
     ORDER BY ci.sort_order`,
    [inspectionId]
  );

  const pct = insp.max_score > 0 ? (insp.total_score / insp.max_score) * 100 : 0;
  const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';

  return {
    ...insp,
    grade,
    pct: Math.round(pct * 10) / 10,
    results,
    summary: {
      total: results.length,
      // Use max_score_snapshot when available (survives check_item deletion); fall back to ci.max_score.
      passed: results.filter(r => r.score >= ((r.max_score_snapshot != null ? r.max_score_snapshot : r.max_score) * 0.6)).length,
      failed: results.filter(r => r.score < ((r.max_score_snapshot != null ? r.max_score_snapshot : r.max_score) * 0.6)).length,
      critical: results.filter(r => r.score === 0 && (r.max_score_snapshot != null ? r.max_score_snapshot : r.max_score) > 0).length,
    }
  };
}

async function getStoreScoreHistory(db, storeId, limit = 10) {
  return db.all(
    `SELECT i.id, i.template_id, t.name as template_name, i.total_score, i.max_score,
            i.grade, i.score_pct, i.type, i.completed_at
     FROM inspections i
     LEFT JOIN inspection_templates t ON t.id = i.template_id
     WHERE i.store_id = ? AND i.status = 'completed'
     ORDER BY i.completed_at DESC LIMIT ?`,
    [storeId, limit]
  );
}

module.exports = {
  initInspectionSchema,
  createTemplate, listTemplates, getTemplate, updateTemplate, deleteTemplate,
  addCheckItem, updateCheckItem, deleteCheckItem,
  createInspection, submitInspectionResults, listInspections, getInspection,
  createIssue, updateIssue, listIssues,
  createSelfCheck, submitSelfCheckResults,
  getInspectionScorecard, getStoreScoreHistory,
};

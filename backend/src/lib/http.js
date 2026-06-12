const { PRODUCT_CSV_FIELDS, getStoreById } = require('../db');

function respondDataError(res, error) {
  const message = String(error?.message || 'Request failed');

  if (message.includes('not found') || message.includes('Reminder not found')) {
    return res.status(404).json({ error: message });
  }

  if (message.includes('already used') || message.includes('already handled')) {
    return res.status(409).json({ error: message });
  }

  if (message.includes('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'Constraint violation' });
  }

  if (message.includes('Invalid binding code') || message.includes('expired')) {
    return res.status(400).json({ error: message });
  }

  return res.status(400).json({ error: message });
}

// Pagination contract: list db functions return a plain array when no `limit`
// query param is given (legacy shape) and an { items, total, limit, offset }
// envelope when `limit` is present. `key` names the legacy wrapper property.
function sendList(res, key, result) {
  if (Array.isArray(result)) {
    return res.json({ [key]: result });
  }
  return res.json(result);
}

function csvEscape(value) {
  if (value == null) {
    return '';
  }
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvEscape(row[c.key])).join(','))
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(rowsToCsv(columns, rows));
}

// P1-2: products CSV columns. Header labels equal the import field names so an
// exported file (or the downloaded template) can be re-imported unchanged.
const PRODUCT_CSV_COLUMNS = PRODUCT_CSV_FIELDS.map((field) => ({ key: field, label: field }));

// ─── Feature A: Store staff management (admin) ──────────────────────────
// When the admin is brand-scoped, the target store must belong to that brand.
// Shared by the store-staff, revoke-tokens, and compliance scope checks.
function makeAssertStoreInScope(db) {
  return async function assertStoreInScope(req, res, storeId) {
    const store = await getStoreById(db, storeId);
    if (!store) {
      res.status(404).json({ error: 'storeId not found' });
      return null;
    }
    if (req.admin.brandId != null && store.brandId !== req.admin.brandId) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return store;
  };
}

module.exports = {
  respondDataError,
  sendList,
  csvEscape,
  rowsToCsv,
  sendCsv,
  PRODUCT_CSV_COLUMNS,
  makeAssertStoreInScope
};

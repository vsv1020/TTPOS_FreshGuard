// ─── P1-2: products CSV import (admin) ────────────────────────────────────────

// Minimal RFC-4180-style CSV parser (quotes, escaped quotes, CRLF, embedded
// newlines). Returns [{ line, cells }] where `line` is the 1-based line number
// the row starts on, so import errors can point at the right line.
function parseCsvRows(text) {
  const source = String(text == null ? '' : text);
  const rows = [];
  let cells = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushField = () => {
    cells.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push({ line: rowStartLine, cells });
    cells = [];
    rowStartLine = line;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') {
          line += 1;
        }
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      line += 1;
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || cells.length > 0) {
    pushRow();
  }
  return rows;
}

module.exports = {
  parseCsvRows
};

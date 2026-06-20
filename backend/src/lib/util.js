const crypto = require('crypto');

const LABEL_LANGUAGE_SINGLE = 'single';
const LABEL_LANGUAGE_BILINGUAL = 'bilingual';
// 'discounted' (P2-3): the unit was moved to a near-expiry promotion and sold.
const HANDLING_REASONS = ['discarded', 'sold', 'transferred', 'discounted'];

// P2-3: promo rule actions applied to expiring reminders (brand-level config).
const PROMO_ACTIONS = ['discount', 'remove'];

// P2-2: four-color coding (中国后厨色标规范). Thermal printing is monochrome,
// so labels carry the color as a text marker (colorLabel); real color blocks
// are rendered by the app/admin UI.
const PRODUCT_COLOR_CODES = ['red', 'blue', 'green', 'yellow'];
const PRODUCT_COLOR_LABELS = {
  red: '红·畜肉禽类',
  blue: '蓝·水产',
  green: '绿·果蔬',
  yellow: '黄·熟食半成品'
};

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addHoursIso(iso, hours) {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() + hours);
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

function generateBindingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = {
  LABEL_LANGUAGE_SINGLE,
  LABEL_LANGUAGE_BILINGUAL,
  HANDLING_REASONS,
  PROMO_ACTIONS,
  PRODUCT_COLOR_CODES,
  PRODUCT_COLOR_LABELS,
  nowIso,
  addDaysIso,
  addHoursIso,
  requirePositiveInteger,
  normalizePagination,
  likeParam,
  generateBindingCode
};

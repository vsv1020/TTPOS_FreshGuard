const { PROMO_ACTIONS } = require('./util');

// ─── P2-3: near-expiry promo rules (brand-level, applied at query time) ───────
// Rules are stored sorted by hoursBeforeExpiry descending and applied in that
// order; the matching rule with the smallest hoursBeforeExpiry that still
// covers the remaining time wins (命中最近一档). Already-expired reminders fall
// into the tightest tier.

function normalizePromoRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error('rules must be an array');
  }
  const normalized = rules.map((rule) => {
    const hours = Number(rule?.hoursBeforeExpiry);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('hoursBeforeExpiry must be a positive number');
    }
    const action = String(rule?.action || '').trim().toLowerCase();
    if (!PROMO_ACTIONS.includes(action)) {
      throw new Error('action must be discount or remove');
    }
    const entry = { hoursBeforeExpiry: hours, action };
    if (action === 'discount') {
      const percent = Number(rule?.discountPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        throw new Error('discountPercent must be a number between 0 and 100 (exclusive) for discount rules');
      }
      entry.discountPercent = percent;
    } else if (rule?.discountPercent != null) {
      throw new Error('discountPercent is only valid for discount rules');
    }
    return entry;
  });
  const seen = new Set();
  for (const rule of normalized) {
    if (seen.has(rule.hoursBeforeExpiry)) {
      throw new Error('duplicate hoursBeforeExpiry in rules');
    }
    seen.add(rule.hoursBeforeExpiry);
  }
  return normalized.sort((a, b) => b.hoursBeforeExpiry - a.hoursBeforeExpiry);
}

function parsePromoRules(json) {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns null or { action, hoursBeforeExpiry, discountPercent? } for the rule
// hit by the remaining time until expiresAt (computed at query time, not stored).
function computeReminderPromo(rules, expiresAt, nowMs = Date.now()) {
  if (!rules || rules.length === 0) {
    return null;
  }
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    return null;
  }
  const hoursLeft = (expiresMs - nowMs) / (60 * 60 * 1000);
  let matched = null;
  for (const rule of rules) {
    // rules are sorted descending, so the last hit is the tightest tier.
    if (hoursLeft <= rule.hoursBeforeExpiry) {
      matched = rule;
    }
  }
  if (!matched) {
    return null;
  }
  const promo = { action: matched.action, hoursBeforeExpiry: matched.hoursBeforeExpiry };
  if (matched.discountPercent != null) {
    promo.discountPercent = matched.discountPercent;
  }
  return promo;
}

module.exports = {
  normalizePromoRules,
  parsePromoRules,
  computeReminderPromo
};

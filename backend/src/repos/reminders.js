const { requirePositiveInteger, likeParam, normalizePagination, nowIso, HANDLING_REASONS } = require('../lib/util');
const {
  getProductLabelLanguages,
  colorCodeLabel,
  buildLabelTemplateFields,
  renderLabelFromTemplate,
  renderLabelTemplate
} = require('../lib/labels');
const { parsePromoRules, computeReminderPromo } = require('../lib/promo');
const { getStoreById } = require('./stores');
const { getProductById } = require('./products');
const { assertStoreStaff } = require('./staff');
const { getDefaultLabelTemplate } = require('./label-templates');

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

  // Brand-level config: expiring threshold fallback + P2-3 promo rules.
  const brandConfigRow = await db.get(
    `SELECT b.reminder_threshold_days AS thresholdDays,
            b.promo_rules AS promoRules
     FROM stores s
     JOIN brands b ON b.id = s.brand_id
     WHERE s.id = ?`,
    normalizedStoreId
  );
  const promoRules = parsePromoRules(brandConfigRow?.promoRules);

  // When no explicit threshold is given, fall back to the brand-level reminder
  // config (reminder_threshold_days), then to the historical default of 1 day.
  let effectiveThresholdDays = thresholdDays;
  if (effectiveThresholdDays == null || effectiveThresholdDays === '') {
    effectiveThresholdDays = brandConfigRow?.thresholdDays != null ? brandConfigRow.thresholdDays : 1;
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

  // P2-3: promo is computed from the remaining time at query time (not stored).
  const promoNowMs = Date.now();
  const toReminder = (row) => ({
    ...row,
    is_priority: row.is_priority === 1,
    promo: computeReminderPromo(promoRules, row.expiresAt, promoNowMs)
  });

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
    throw new Error('reason must be one of discarded, sold, transferred, discounted');
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
      colorCode: product.colorCode || null,
      colorLabel: colorCodeLabel(product.colorCode),
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
  normalizeReminderStatus,
  listStoreReminders,
  handleReminder,
  openReminder,
  runReminderScan
};

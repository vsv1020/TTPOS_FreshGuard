const { requirePositiveInteger, nowIso, addDaysIso } = require('../lib/util');
const {
  getProductLabelLanguages,
  colorCodeLabel,
  getStorePrinterSettings,
  buildLabelTemplateFields,
  renderLabelFromTemplate,
  renderLabelTemplate
} = require('../lib/labels');
const { getStoreById } = require('./stores');
const { getProductById } = require('./products');
const { assertStoreStaff } = require('./staff');
const { getDefaultLabelTemplate } = require('./label-templates');

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
      colorCode: product.colorCode || null,
      colorLabel: colorCodeLabel(product.colorCode),
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

// ─── P1-4/P1-5: barcode scan lookup + historical label reprint (store) ───────

async function getStoreBatchById(db, { storeId, batchId }) {
  return db.get(
    `SELECT b.id,
            b.store_id AS storeId,
            b.product_id AS productId,
            p.name AS productName,
            b.quantity,
            b.printed_at AS printedAt,
            b.expires_at AS expiresAt,
            b.barcode_data AS barcodeData,
            b.printed_by_staff_id AS printedByStaffId,
            b.created_at AS createdAt
     FROM batches b
     JOIN products p ON p.id = b.product_id
     WHERE b.id = ? AND b.store_id = ?`,
    requirePositiveInteger(batchId, 'batchId'),
    requirePositiveInteger(storeId, 'storeId')
  );
}

// Resolve a printed label barcode back to its batch, scoped to the calling
// store (a barcode from another store is simply "not found"). Returns null
// when no batch matches; otherwise { batch, reminder } where reminder is the
// earliest unhandled reminder of the batch (FEFO) or null when all handled.
async function getStoreBatchByBarcode(db, { storeId, code }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    throw new Error('code is required');
  }

  const batch = await db.get(
    `SELECT b.id,
            b.store_id AS storeId,
            b.product_id AS productId,
            p.name AS productName,
            b.quantity,
            b.printed_at AS printedAt,
            b.expires_at AS expiresAt,
            b.barcode_data AS barcodeData,
            b.printed_by_staff_id AS printedByStaffId,
            b.created_at AS createdAt
     FROM batches b
     JOIN products p ON p.id = b.product_id
     WHERE b.barcode_data = ? AND b.store_id = ?`,
    normalizedCode,
    normalizedStoreId
  );
  if (!batch) {
    return null;
  }

  const reminder = await db.get(
    `SELECT r.id,
            r.batch_id AS batchId,
            r.store_id AS storeId,
            r.product_id AS productId,
            p.name AS productName,
            r.expires_at AS expiresAt,
            r.status,
            r.note,
            r.handled_at AS handledAt,
            r.created_at AS createdAt
     FROM reminders r
     JOIN products p ON p.id = r.product_id
     WHERE r.batch_id = ? AND r.handled_at IS NULL
     ORDER BY datetime(r.expires_at) ASC, r.id ASC
     LIMIT 1`,
    batch.id
  );

  return { batch, reminder: reminder || null };
}

// Re-render the label of a historical batch. The returned `label` has exactly
// the same shape as the `label` in the POST /api/store/print response (same
// builder: default brand template when present, built-in layout otherwise).
async function renderStoreBatchLabel(db, { storeId, batchId }) {
  const normalizedStoreId = requirePositiveInteger(storeId, 'storeId');
  const batch = await getStoreBatchById(db, { storeId: normalizedStoreId, batchId });
  if (!batch) {
    throw new Error('batchId not found');
  }

  const store = await getStoreById(db, normalizedStoreId);
  if (!store) {
    throw new Error('storeId not found');
  }
  const product = await getProductById(db, batch.productId);
  if (!product) {
    throw new Error('productId not found');
  }

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
    colorCode: product.colorCode || null,
    colorLabel: colorCodeLabel(product.colorCode),
    staffId: batch.printedByStaffId != null ? batch.printedByStaffId : null
  };

  const defaultTemplate = await getDefaultLabelTemplate(db, { brandId: store.brandId });
  const templateFields = buildLabelTemplateFields(label);
  const text = defaultTemplate && defaultTemplate.bodyTemplate
    ? renderLabelFromTemplate(defaultTemplate.bodyTemplate, templateFields)
    : renderLabelTemplate(label);

  return {
    batch,
    store,
    printerSettings: getStorePrinterSettings(store),
    label: {
      ...label,
      templateBody: defaultTemplate ? defaultTemplate.bodyTemplate : null,
      fields: templateFields,
      text
    }
  };
}

module.exports = {
  createBatchWithReminders,
  getStoreBatchById,
  getStoreBatchByBarcode,
  renderStoreBatchLabel
};

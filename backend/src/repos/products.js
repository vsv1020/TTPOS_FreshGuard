const {
  requirePositiveInteger,
  likeParam,
  normalizePagination,
  nowIso,
  LABEL_LANGUAGE_BILINGUAL
} = require('../lib/util');
const { normalizeLabelLanguage, normalizeColorCode } = require('../lib/labels');
const { parseCsvRows } = require('../lib/csv');
const { getBrandById } = require('./brands');
const { getStoreById } = require('./stores');

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
            p.cost_price AS costPrice,
            p.color_code AS colorCode,
            p.is_active AS isActive,
            p.external_ref AS externalRef,
            p.source AS source,
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

function normalizeCostPrice(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('costPrice must be a non-negative number');
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
    openedShelfLifeHours,
    costPrice,
    colorCode,
    externalRef,
    source
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
  const normalizedCostPrice = normalizeCostPrice(costPrice);
  const normalizedColorCode = normalizeColorCode(colorCode);
  const normalizedExternalRef = String(externalRef || '').trim() || null;
  const normalizedSource = String(source || '').trim() || 'manual';

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
      opened_shelf_life_hours,
      cost_price,
      color_code,
      external_ref,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    normalizedBrandId,
    normalizedName,
    normalizedSku,
    normalizedShelfLifeDays,
    normalizedLabelLanguage,
    normalizedPrimaryLanguage,
    normalizedSecondaryLanguage,
    normalizedAllergens,
    normalizedStorageConditions,
    normalizedOpenedShelfLifeHours,
    normalizedCostPrice,
    normalizedColorCode,
    normalizedExternalRef,
    normalizedSource
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
  openedShelfLifeHours: 'opened_shelf_life_hours',
  costPrice: 'cost_price',
  colorCode: 'color_code',
  // ERP sync only. isActive is the soft-delete / reactivate toggle and is NOT
  // exposed via the PATCH /api/admin/products/:id route body handler.
  isActive: 'is_active',
  externalRef: 'external_ref',
  source: 'source'
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
    } else if (key === 'costPrice') {
      value = normalizeCostPrice(rawValue);
    } else if (key === 'colorCode') {
      value = normalizeColorCode(rawValue);
    } else if (key === 'isActive') {
      value = rawValue ? 1 : 0;
    } else if (key === 'externalRef') {
      value = String(rawValue || '').trim() || null;
    } else if (key === 'source') {
      value = String(rawValue || '').trim() || 'manual';
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
            p.cost_price AS costPrice,
            p.color_code AS colorCode,
            p.is_active AS isActive,
            p.external_ref AS externalRef,
            p.source AS source,
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

// Importable product CSV fields. Header names double as API field names so an
// exported file (GET /api/admin/products?format=csv) can be re-imported as-is.
const PRODUCT_CSV_FIELDS = [
  'brandId',
  'name',
  'sku',
  'shelfLifeDays',
  'labelLanguage',
  'primaryLanguage',
  'secondaryLanguage',
  'allergens',
  'storageConditions',
  'openedShelfLifeHours',
  'costPrice',
  'colorCode'
];

// Upsert key (per the products schema's UNIQUE(brand_id, sku) and
// UNIQUE(brand_id, name) constraints): a row matches an existing product by
// (brandId, sku) when the sku cell is non-empty, otherwise by (brandId, name).
// Matched rows are updated (blank cells leave the stored value untouched),
// the rest are inserted. The import runs in a single transaction that COMMITs
// the valid rows even when some rows fail validation (partial success);
// failures are reported per row with 1-based CSV line numbers.
// `brandId` (option) is the caller's brand scope: when set, rows are forced
// into that brand and a conflicting brandId cell is rejected; when unset
// (platform admin) each row must carry its own brandId.
async function importProductsCsv(db, { csv, brandId } = {}) {
  const scopedBrandId = brandId != null && brandId !== ''
    ? requirePositiveInteger(brandId, 'brandId')
    : null;

  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    throw new Error('csv is required');
  }

  const header = rows[0].cells.map((cell) => String(cell || '').trim());
  const colIndex = new Map();
  header.forEach((name, index) => {
    if (name && !colIndex.has(name)) {
      colIndex.set(name, index);
    }
  });
  if (!colIndex.has('name') || !colIndex.has('shelfLifeDays')) {
    throw new Error('csv header must include name and shelfLifeDays columns');
  }

  let inserted = 0;
  let updated = 0;
  const errors = [];

  await db.exec('BEGIN TRANSACTION');
  try {
    for (const row of rows.slice(1)) {
      if (row.cells.every((cell) => String(cell || '').trim() === '')) {
        continue;
      }
      const cell = (field) => {
        const index = colIndex.get(field);
        if (index == null) {
          return '';
        }
        return String(row.cells[index] == null ? '' : row.cells[index]).trim();
      };

      try {
        let rowBrandId = scopedBrandId;
        const brandCell = cell('brandId');
        if (scopedBrandId != null) {
          if (brandCell && Number(brandCell) !== scopedBrandId) {
            throw new Error('brandId is outside your brand scope');
          }
        } else {
          if (!brandCell) {
            throw new Error('brandId is required');
          }
          rowBrandId = requirePositiveInteger(brandCell, 'brandId');
        }

        const name = cell('name');
        if (!name) {
          throw new Error('name is required');
        }
        const sku = cell('sku') || null;

        const existing = sku
          ? await db.get('SELECT id FROM products WHERE brand_id = ? AND sku = ?', rowBrandId, sku)
          : await db.get('SELECT id FROM products WHERE brand_id = ? AND name = ?', rowBrandId, name);

        if (existing) {
          // Blank cells keep the stored value (so a sparse CSV is safe).
          const patch = {};
          for (const field of PRODUCT_CSV_FIELDS) {
            if (field === 'brandId' || !colIndex.has(field)) {
              continue;
            }
            const value = cell(field);
            if (value !== '') {
              patch[field] = value;
            }
          }
          await updateProduct(db, existing.id, patch);
          updated += 1;
        } else {
          await createProduct(db, {
            brandId: rowBrandId,
            name,
            sku,
            shelfLifeDays: cell('shelfLifeDays'),
            labelLanguage: cell('labelLanguage') || 'single',
            primaryLanguage: cell('primaryLanguage') || 'en',
            secondaryLanguage: cell('secondaryLanguage') || null,
            allergens: cell('allergens') || null,
            storageConditions: cell('storageConditions') || null,
            openedShelfLifeHours: cell('openedShelfLifeHours') || null,
            costPrice: cell('costPrice') || null,
            colorCode: cell('colorCode') || null
          });
          inserted += 1;
        }
      } catch (error) {
        errors.push({ line: row.line, message: String(error?.message || 'Invalid row') });
      }
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  return { inserted, updated, errors };
}

module.exports = {
  getProductById,
  normalizeOpenedShelfLifeHours,
  normalizeCostPrice,
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
  listStoreProducts,
  PRODUCT_CSV_FIELDS,
  importProductsCsv
};

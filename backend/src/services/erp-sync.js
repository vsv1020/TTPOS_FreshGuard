const { requirePositiveInteger, nowIso } = require('../lib/util');
const { listAll, ErpError, sanitizeMessage } = require('../lib/erp-client');
const {
  getConnectionWithSecret,
  getSelections,
  setSyncStatus
} = require('../repos/erp-connections');
const { createProduct, updateProduct, deleteProduct } = require('../repos/products');

// A run is considered "still in progress" if its status was set to 'running'
// within this window. Older 'running' rows are treated as stale (a crashed run)
// and a new sync may proceed.
const RUNNING_LOCK_MS = 10 * 60 * 1000;

// ─── ERP fetch helpers ──────────────────────────────────────────────────────

async function requireEnabledConnection(db, brandId) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const connection = await getConnectionWithSecret(db, normalizedBrandId);
  if (!connection) {
    throw new Error('ERP connection not found');
  }
  if (!connection.enabled) {
    throw new Error('ERP connection is disabled');
  }
  if (!connection.apiSecret) {
    throw new Error('ERP connection is missing its API secret');
  }
  return connection;
}

// Selectable categories = DISTINCT values of the custom field
// `custom_classification` across active Items. (item_group is uniformly
// "Raw Material" in this ERP and carries no category signal.) Returns
// [{ name }] so the picker renders each as a selectable leaf.
async function fetchItemGroups(db, brandId) {
  const connection = await requireEnabledConnection(db, brandId);
  const rows = await listAll({
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    apiSecret: connection.apiSecret,
    resourcePath: 'api/resource/Item',
    fields: ['custom_classification'],
    filters: [['disabled', '=', 0]]
  });
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const value = String(row.custom_classification || '').trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push({ name: value });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Items in the brand's selected groups. Fetches BOTH disabled=0 and disabled=1
// rows in the selected groups so deactivation/reactivation can be diffed.
// FULLY succeeds or FULLY fails (listAll aborts the whole walk on any page
// error), so a partial list can never drive the sync.
async function fetchItems(db, brandId) {
  const connection = await requireEnabledConnection(db, brandId);
  const selections = await getSelections(db, brandId);
  const classifications = selections.filter((s) => s.enabled).map((s) => s.itemGroup);
  if (classifications.length === 0) {
    return { connection, items: [] };
  }

  const fields = [
    'item_code',
    'item_name',
    'custom_classification',
    'shelf_life_in_days',
    'disabled',
    'valuation_rate'
  ];
  const filters = [
    ['custom_classification', 'in', classifications],
    ['disabled', 'in', [0, 1]]
  ];

  const items = await listAll({
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    apiSecret: connection.apiSecret,
    resourcePath: 'api/resource/Item',
    fields,
    filters
  });

  return { connection, items };
}

// ─── Mapping ──────────────────────────────────────────────────────────────

// Maps a raw ERP Item to a product shape. Throws a per-row error for an empty
// item_code (would write a NULL external_ref) or a missing/non-positive
// shelf life. brand_id is forced to the connection's brand (ERP item.brand is
// ignored). Caller decides insert vs update; this returns the full superset.
function mapItemToProduct(item, connection) {
  const externalRef = String(item && item.item_code != null ? item.item_code : '').trim();
  if (!externalRef) {
    throw new Error('item_code is required');
  }

  // ERP has no usable shelf life (shelf_life_in_days is 0 here), so fall back to
  // the brand-level default. Applied on INSERT only (see runSync) — the admin's
  // per-product shelf life set in FreshGuard is never overwritten by a re-sync.
  const shelfLifeRaw = item.shelf_life_in_days;
  let shelfLifeDays = Number(shelfLifeRaw);
  if (shelfLifeRaw == null || shelfLifeRaw === '' || !Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) {
    shelfLifeDays = Number(connection.defaultShelfLifeDays);
  }
  if (!Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) {
    throw new Error(`no shelf life for item ${externalRef} and no brand default configured`);
  }

  const name = String(item.item_name || item.item_code || '').trim();
  const costPrice = item.valuation_rate == null || item.valuation_rate === ''
    ? null
    : Number(item.valuation_rate);

  return {
    externalRef,
    sku: externalRef,
    name,
    shelfLifeDays: Math.trunc(shelfLifeDays),
    costPrice: costPrice != null && Number.isFinite(costPrice) ? costPrice : null,
    labelLanguage: connection.defaultLabelLanguage,
    primaryLanguage: connection.defaultPrimaryLanguage,
    secondaryLanguage: connection.defaultSecondaryLanguage,
    disabled: item.disabled ? 1 : 0
  };
}

// ─── Diff ───────────────────────────────────────────────────────────────────

// Loads the brand's products keyed by external_ref (erp rows) plus the manual
// sku/name sets used to detect first-sync collisions.
async function loadBrandProductIndex(db, brandId) {
  const rows = await db.all(
    `SELECT id, name, sku, external_ref AS externalRef, source, is_active AS isActive
     FROM products
     WHERE brand_id = ?`,
    brandId
  );
  const byExternalRef = new Map();
  const manualBySku = new Map();
  const manualByName = new Map();
  for (const row of rows) {
    if (row.externalRef) {
      byExternalRef.set(row.externalRef, row);
    }
    if (row.source === 'manual') {
      if (row.sku) {
        manualBySku.set(row.sku, row);
      }
      manualByName.set(row.name, row);
    }
  }
  return { byExternalRef, manualBySku, manualByName };
}

// Computes the sync plan without writing. Rows are matched ONLY by
// (brand_id, external_ref). An unmatched ERP row that would collide with a
// manual product on sku or name is a conflict (skipped, never overwritten).
function buildPlan(items, connection, index) {
  const plan = {
    willInsert: 0,
    willUpdate: 0,
    willDeactivate: 0,
    conflicts: [],
    skipped: [],
    rows: []
  };

  for (const item of items) {
    let mapped;
    try {
      mapped = mapItemToProduct(item, connection);
    } catch (error) {
      plan.skipped.push({
        itemCode: String(item && item.item_code != null ? item.item_code : '') || null,
        reason: String(error?.message || 'Invalid item')
      });
      continue;
    }

    const existing = index.byExternalRef.get(mapped.externalRef);
    if (existing) {
      // Matched ERP row. disabled flips is_active.
      if (mapped.disabled) {
        if (existing.isActive) {
          plan.willDeactivate += 1;
          plan.rows.push({ action: 'deactivate', externalRef: mapped.externalRef, name: mapped.name });
        }
        // already inactive => no-op
      } else {
        plan.willUpdate += 1;
        plan.rows.push({
          action: existing.isActive ? 'update' : 'reactivate',
          externalRef: mapped.externalRef,
          name: mapped.name
        });
      }
      continue;
    }

    // Unmatched ERP row.
    if (mapped.disabled) {
      // A disabled item we've never imported: nothing to insert or deactivate.
      plan.skipped.push({ itemCode: mapped.externalRef, reason: 'disabled item not previously synced' });
      continue;
    }

    const collision = index.manualBySku.get(mapped.sku) || index.manualByName.get(mapped.name);
    if (collision) {
      plan.conflicts.push({
        itemCode: mapped.externalRef,
        name: mapped.name,
        reason: `collides with manual product #${collision.id} on ${index.manualBySku.get(mapped.sku) ? 'sku' : 'name'}`
      });
      continue;
    }

    plan.willInsert += 1;
    plan.rows.push({ action: 'insert', externalRef: mapped.externalRef, name: mapped.name });
  }

  return plan;
}

async function previewSync(db, brandId) {
  const { connection, items } = await fetchItems(db, brandId);
  const index = await loadBrandProductIndex(db, requirePositiveInteger(brandId, 'brandId'));
  return buildPlan(items, connection, index);
}

// ─── Run ──────────────────────────────────────────────────────────────────

// True when a run is currently in progress (status 'running' set within the
// lock window). A stale 'running' (crashed run) is NOT treated as locked.
function isLockedRunning(connection) {
  if (!connection || connection.lastSyncStatus !== 'running') {
    return false;
  }
  if (!connection.lastSyncAt) {
    return false;
  }
  const startedAt = Date.parse(connection.lastSyncAt);
  if (Number.isNaN(startedAt)) {
    return false;
  }
  return Date.now() - startedAt < RUNNING_LOCK_MS;
}

// Executes the sync in a single transaction, mirroring importProductsCsv:
// per-row try/catch collects errors and the valid rows COMMIT together.
// recordAudit is intentionally deferred to the caller-facing route which has
// the actor's email/ip; runSync writes setSyncStatus and returns a summary.
async function runSync(db, brandId, actor = {}) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');

  // Concurrency guard: refuse to start a second run while one is in progress.
  const current = await getConnectionWithSecret(db, normalizedBrandId);
  if (!current) {
    throw new Error('ERP connection not found');
  }
  if (isLockedRunning(current)) {
    const error = new Error('A sync is already running');
    error.code = 'SYNC_RUNNING';
    throw error;
  }

  // Mark running BEFORE the network fetch so a concurrent POST is rejected.
  await setSyncStatus(db, normalizedBrandId, { at: nowIso(), status: 'running', detail: null });

  let items;
  let connection;
  try {
    const fetched = await fetchItems(db, normalizedBrandId);
    items = fetched.items;
    connection = fetched.connection;
  } catch (error) {
    // FULLY-fail: never run the sync on a partial list. Record and surface.
    const detail = sanitizeMessage(error instanceof ErpError ? `${error.kind}: ${error.message}` : (error?.message || 'fetch failed'));
    await setSyncStatus(db, normalizedBrandId, { at: nowIso(), status: 'error', detail });
    const wrapped = new Error(detail);
    wrapped.kind = error instanceof ErpError ? error.kind : undefined;
    throw wrapped;
  }

  const index = await loadBrandProductIndex(db, normalizedBrandId);

  let inserted = 0;
  let updated = 0;
  let reactivated = 0;
  let deactivated = 0;
  const errors = [];

  await db.exec('BEGIN TRANSACTION');
  try {
    for (const item of items) {
      try {
        const mapped = mapItemToProduct(item, connection);
        const existing = index.byExternalRef.get(mapped.externalRef);

        if (existing) {
          if (mapped.disabled) {
            if (existing.isActive) {
              await deleteProduct(db, existing.id); // conservative soft-delete
              deactivated += 1;
            }
            continue;
          }
          // Sparse update patch. costPrice and shelfLifeDays are OMITTED
          // (insert-only: ERP has no real shelf life, so a re-sync must never
          // clobber the admin's per-product value). sku is seeded on insert
          // only. allergens / storageConditions / openedShelfLifeHours /
          // colorCode are omitted to preserve manual edits.
          const patch = {
            name: mapped.name,
            labelLanguage: mapped.labelLanguage,
            primaryLanguage: mapped.primaryLanguage,
            secondaryLanguage: mapped.secondaryLanguage
          };
          if (!existing.isActive) {
            patch.isActive = 1;
            reactivated += 1;
          } else {
            updated += 1;
          }
          await updateProduct(db, existing.id, patch);
          continue;
        }

        // Unmatched ERP row.
        if (mapped.disabled) {
          // Never imported + disabled: skip silently (nothing to deactivate).
          continue;
        }

        const collision = index.manualBySku.get(mapped.sku) || index.manualByName.get(mapped.name);
        if (collision) {
          // BLOCKER: never adopt/overwrite a manual product. Report per-row.
          throw new Error(
            `item_code ${mapped.externalRef} collides with manual product #${collision.id}; skipped`
          );
        }

        await createProduct(db, {
          brandId: normalizedBrandId,
          name: mapped.name,
          sku: mapped.sku,
          shelfLifeDays: mapped.shelfLifeDays,
          labelLanguage: mapped.labelLanguage,
          primaryLanguage: mapped.primaryLanguage,
          secondaryLanguage: mapped.secondaryLanguage,
          costPrice: mapped.costPrice, // insert-only
          externalRef: mapped.externalRef,
          source: 'erp'
          // allergens / storageConditions / openedShelfLifeHours / colorCode => NULL
        });
        inserted += 1;
      } catch (error) {
        errors.push({
          itemCode: String(item && item.item_code != null ? item.item_code : '') || null,
          message: String(error?.message || 'Invalid row')
        });
      }
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    const detail = sanitizeMessage(error?.message || 'sync failed');
    await setSyncStatus(db, normalizedBrandId, { at: nowIso(), status: 'error', detail });
    throw new Error(detail);
  }

  const summary = { inserted, updated, reactivated, deactivated, errors };
  const detail = `inserted=${inserted} updated=${updated} reactivated=${reactivated} deactivated=${deactivated} errors=${errors.length}`;
  const status = errors.length > 0 ? 'partial' : 'success';
  await setSyncStatus(db, normalizedBrandId, { at: nowIso(), status, detail });

  return { ...summary, status, detail, actor: actor && actor.email ? actor.email : null };
}

module.exports = {
  RUNNING_LOCK_MS,
  fetchItemGroups,
  fetchItems,
  mapItemToProduct,
  previewSync,
  runSync
};

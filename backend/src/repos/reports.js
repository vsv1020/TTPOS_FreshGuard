const { requirePositiveInteger, likeParam, normalizePagination } = require('../lib/util');

// ─── P1-3: waste dashboard report ─────────────────────────────────────────────
// totalBatches counts batches printed in the [from, to] window; discardedCount
// counts distinct batches with at least one 'discarded' handling log handled in
// the window; wasteRate = discardedCount / totalBatches (0 when no batches).
// discardAmount sums products.cost_price once per discarded unit (handling
// log); units whose product has no cost contribute 0 and are counted in
// summary.missingCostCount. byReason counts handling-log units per reason.
async function getWasteReport(db, { brandId, storeId, from, to } = {}) {
  const normalizedBrandId = brandId != null && brandId !== ''
    ? requirePositiveInteger(brandId, 'brandId')
    : null;
  const normalizedStoreId = storeId != null && storeId !== ''
    ? requirePositiveInteger(storeId, 'storeId')
    : null;
  const normalizedFrom = from != null && String(from).trim() ? String(from).trim() : null;
  const normalizedTo = to != null && String(to).trim() ? String(to).trim() : null;

  const buildFilter = (dateColumn) => {
    const clauses = ['1=1'];
    const params = [];
    if (normalizedBrandId != null) {
      clauses.push('s.brand_id = ?');
      params.push(normalizedBrandId);
    }
    if (normalizedStoreId != null) {
      clauses.push('s.id = ?');
      params.push(normalizedStoreId);
    }
    if (normalizedFrom) {
      clauses.push(`datetime(${dateColumn}) >= datetime(?)`);
      params.push(normalizedFrom);
    }
    if (normalizedTo) {
      clauses.push(`datetime(${dateColumn}) <= datetime(?)`);
      params.push(normalizedTo);
    }
    return { whereSql: clauses.join(' AND '), params };
  };

  const batchFilter = buildFilter('b.printed_at');
  const totalsByStore = await db.all(
    `SELECT s.id AS storeId, s.name AS storeName, COUNT(*) AS totalBatches
     FROM batches b
     JOIN stores s ON s.id = b.store_id
     WHERE ${batchFilter.whereSql}
     GROUP BY s.id`,
    ...batchFilter.params
  );
  const totalsByProduct = await db.all(
    `SELECT p.id AS productId, p.name AS productName, COUNT(*) AS totalBatches
     FROM batches b
     JOIN stores s ON s.id = b.store_id
     JOIN products p ON p.id = b.product_id
     WHERE ${batchFilter.whereSql}
     GROUP BY p.id`,
    ...batchFilter.params
  );

  const logFilter = buildFilter('hl.handled_at');
  const logFromSql = `FROM handling_logs hl
     JOIN reminders r ON r.id = hl.reminder_id
     JOIN stores s ON s.id = hl.store_id
     JOIN products p ON p.id = hl.product_id
     WHERE ${logFilter.whereSql}`;

  const discardSelect = `COUNT(DISTINCT r.batch_id) AS discardedCount,
            SUM(COALESCE(p.cost_price, 0)) AS discardAmount,
            SUM(CASE WHEN p.cost_price IS NULL THEN 1 ELSE 0 END) AS missingCostCount`;

  const discardByStore = await db.all(
    `SELECT s.id AS storeId, s.name AS storeName, ${discardSelect}
     ${logFromSql} AND hl.reason = 'discarded'
     GROUP BY s.id`,
    ...logFilter.params
  );
  const discardByProduct = await db.all(
    `SELECT p.id AS productId, p.name AS productName, ${discardSelect}
     ${logFromSql} AND hl.reason = 'discarded'
     GROUP BY p.id`,
    ...logFilter.params
  );
  const byReason = await db.all(
    `SELECT hl.reason AS reason, COUNT(*) AS count
     ${logFromSql}
     GROUP BY hl.reason
     ORDER BY hl.reason ASC`,
    ...logFilter.params
  );
  const trend = await db.all(
    `SELECT date(hl.handled_at) AS date,
            COUNT(DISTINCT r.batch_id) AS discardedCount,
            SUM(COALESCE(p.cost_price, 0)) AS discardAmount
     ${logFromSql} AND hl.reason = 'discarded'
     GROUP BY date(hl.handled_at)
     ORDER BY date(hl.handled_at) ASC`,
    ...logFilter.params
  );

  // Merge totals with discard aggregates (a key may appear in only one side,
  // e.g. a batch printed before the window but discarded inside it).
  const mergeRows = (totals, discards, idKey, nameKey) => {
    const map = new Map();
    for (const row of totals) {
      map.set(row[idKey], {
        [idKey]: row[idKey],
        [nameKey]: row[nameKey],
        totalBatches: Number(row.totalBatches || 0),
        discardedCount: 0,
        discardAmount: 0
      });
    }
    for (const row of discards) {
      const entry = map.get(row[idKey]) || {
        [idKey]: row[idKey],
        [nameKey]: row[nameKey],
        totalBatches: 0,
        discardedCount: 0,
        discardAmount: 0
      };
      entry.discardedCount = Number(row.discardedCount || 0);
      entry.discardAmount = Number(row.discardAmount || 0);
      map.set(row[idKey], entry);
    }
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        wasteRate: entry.totalBatches > 0 ? entry.discardedCount / entry.totalBatches : 0
      }))
      .sort((a, b) => a[idKey] - b[idKey]);
  };

  const byStore = mergeRows(totalsByStore, discardByStore, 'storeId', 'storeName');
  const byProduct = mergeRows(totalsByProduct, discardByProduct, 'productId', 'productName');

  const totalBatches = totalsByStore.reduce((sum, row) => sum + Number(row.totalBatches || 0), 0);
  const discardedCount = discardByStore.reduce((sum, row) => sum + Number(row.discardedCount || 0), 0);
  const discardAmount = discardByStore.reduce((sum, row) => sum + Number(row.discardAmount || 0), 0);
  const missingCostCount = discardByStore.reduce((sum, row) => sum + Number(row.missingCostCount || 0), 0);

  return {
    summary: {
      totalBatches,
      discardedCount,
      wasteRate: totalBatches > 0 ? discardedCount / totalBatches : 0,
      discardAmount,
      missingCostCount
    },
    byStore,
    byProduct,
    byReason: byReason.map((row) => ({ reason: row.reason, count: Number(row.count || 0) })),
    trend: trend.map((row) => ({
      date: row.date,
      discardedCount: Number(row.discardedCount || 0),
      discardAmount: Number(row.discardAmount || 0)
    }))
  };
}

async function listExpiredHandlingReport(db, { brandId, startDate, endDate, q, limit, offset } = {}) {
  const params = [];
  const whereClauses = [];

  if (brandId != null) {
    const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
    whereClauses.push('s.brand_id = ?');
    params.push(normalizedBrandId);
  }

  // Optional date range filters expired reminders by handled_at (when handled)
  // falling back to the batch printed_at for unhandled ones.
  const effectiveDate = "COALESCE(r.handled_at, bt.printed_at)";
  if (startDate != null && String(startDate).trim()) {
    whereClauses.push(`datetime(${effectiveDate}) >= datetime(?)`);
    params.push(String(startDate).trim());
  }
  if (endDate != null && String(endDate).trim()) {
    whereClauses.push(`datetime(${effectiveDate}) <= datetime(?)`);
    params.push(String(endDate).trim());
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(s.name LIKE ? OR p.name LIKE ?)');
    params.push(likeParam(q), likeParam(q));
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // FEFO: report rows ordered by the earliest expiry first.
  const selectSql = `SELECT s.id AS storeId,
            s.name AS storeName,
            p.id AS productId,
            p.name AS productName,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expiredTotalCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS expiredHandledCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NULL THEN 1 ELSE 0 END) AS expiredUnhandledCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'discarded' THEN 1 ELSE 0 END) AS discardedCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'sold' THEN 1 ELSE 0 END) AS soldCount,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND hl.reason = 'transferred' THEN 1 ELSE 0 END) AS transferredCount
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     JOIN products p ON p.id = r.product_id
     JOIN batches bt ON bt.id = r.batch_id
     LEFT JOIN handling_logs hl ON hl.reminder_id = r.id
     ${whereSql}
     GROUP BY s.id, p.id
     HAVING SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) > 0
     ORDER BY MIN(datetime(r.expires_at)) ASC, s.id ASC, p.id ASC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    return db.all(selectSql, ...params);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM (${selectSql})`, ...params);
  const items = await db.all(
    `${selectSql} LIMIT ? OFFSET ?`,
    ...params,
    pagination.limit,
    pagination.offset
  );
  return { items, total: Number(totalRow?.c || 0), limit: pagination.limit, offset: pagination.offset };
}

module.exports = {
  getWasteReport,
  listExpiredHandlingReport
};

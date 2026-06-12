const { requirePositiveInteger, nowIso, addDaysIso } = require('../lib/util');
const { getBrandById } = require('./brands');

// ─── Feature B: Dashboard aggregation (read-only, brand-scoped) ──────────────

function brandScopeClause(brandId, alias, params) {
  if (brandId == null) {
    return '';
  }
  params.push(requirePositiveInteger(brandId, 'brandId'));
  return `AND ${alias}.brand_id = ?`;
}

// P2-5 drilldown: normalizes optional from/to/storeId filters shared by the
// dashboard aggregation functions. Defaults (null) keep each query's
// historical window.
function normalizeDashboardFilters({ storeId, from, to } = {}) {
  return {
    storeId: storeId != null && storeId !== '' ? requirePositiveInteger(storeId, 'storeId') : null,
    from: from != null && String(from).trim() ? String(from).trim() : null,
    to: to != null && String(to).trim() ? String(to).trim() : null
  };
}

function storeIdClause(storeId, alias, params) {
  if (storeId == null) {
    return '';
  }
  params.push(storeId);
  return `AND ${alias}.id = ?`;
}

async function getDashboardSummary(db, { brandId, storeId, from, to } = {}) {
  const filters = normalizeDashboardFilters({ storeId, from, to });
  const storeParams = [];
  const storeScope = brandScopeClause(brandId, 's', storeParams);
  const storeIdScope = storeIdClause(filters.storeId, 's', storeParams);

  const brandCountRow = brandId == null
    ? await db.get('SELECT COUNT(*) AS c FROM brands')
    : { c: (await getBrandById(db, brandId)) ? 1 : 0 };

  const productParams = [];
  const productScope = brandScopeClause(brandId, 'p', productParams);
  const countsRow = await db.get(
    `SELECT
        (SELECT COUNT(*) FROM stores s WHERE 1=1 ${storeScope} ${storeIdScope}) AS storeCount,
        (SELECT COUNT(*) FROM products p WHERE 1=1 ${productScope}) AS productCount`,
    ...storeParams,
    ...productParams
  );

  // handledRate window: defaults to the historical "last 30 days up to now";
  // from/to (ISO) override either bound.
  const rateStart = filters.from || addDaysIso(nowIso(), -30);
  const rateEnd = filters.to || nowIso();

  // Single pass over the relevant reminders (pending ones plus the rate window)
  // instead of three separate COUNT scans.
  const reminderParams = [rateStart, rateEnd, rateStart, rateEnd, rateStart];
  const reminderScope = brandScopeClause(brandId, 's', reminderParams);
  const reminderStoreScope = storeIdClause(filters.storeId, 's', reminderParams);
  const reminderRow = await db.get(
    `SELECT
        SUM(CASE WHEN r.handled_at IS NULL
                 AND datetime(r.expires_at) >= datetime('now')
                 AND datetime(r.expires_at) <= datetime('now', '+1 day') THEN 1 ELSE 0 END) AS todayExpiring,
        SUM(CASE WHEN r.handled_at IS NULL
                 AND datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS unhandledExpired,
        SUM(CASE WHEN datetime(r.expires_at) >= datetime(?)
                 AND datetime(r.expires_at) <= datetime(?) THEN 1 ELSE 0 END) AS rateTotal,
        SUM(CASE WHEN datetime(r.expires_at) >= datetime(?)
                 AND datetime(r.expires_at) <= datetime(?)
                 AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS rateHandled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE (r.handled_at IS NULL OR datetime(r.expires_at) >= datetime(?))
       ${reminderScope} ${reminderStoreScope}`,
    ...reminderParams
  );

  const total = Number(reminderRow?.rateTotal || 0);
  const handled = Number(reminderRow?.rateHandled || 0);
  const handledRate = total > 0 ? handled / total : 0;

  return {
    brands: Number(brandCountRow?.c || 0),
    stores: Number(countsRow?.storeCount || 0),
    products: Number(countsRow?.productCount || 0),
    todayExpiringCount: Number(reminderRow?.todayExpiring || 0),
    unhandledExpiredCount: Number(reminderRow?.unhandledExpired || 0),
    handledRate
  };
}

async function getStoreExpiryRanking(db, { brandId, storeId, from, to, limit = 10 } = {}) {
  const filters = normalizeDashboardFilters({ storeId, from, to });

  // Default window: unhandled reminders expiring within the next day.
  // With from/to, the window becomes [from, to] on expires_at instead.
  const joinParams = [];
  let windowSql;
  if (filters.from || filters.to) {
    const clauses = [];
    if (filters.from) {
      clauses.push('datetime(r.expires_at) >= datetime(?)');
      joinParams.push(filters.from);
    }
    if (filters.to) {
      clauses.push('datetime(r.expires_at) <= datetime(?)');
      joinParams.push(filters.to);
    }
    windowSql = clauses.join('\n       AND ');
  } else {
    windowSql = `datetime(r.expires_at) <= datetime('now', '+1 day')`;
  }

  const whereParams = [];
  const scope = brandScopeClause(brandId, 's', whereParams);
  const storeScope = storeIdClause(filters.storeId, 's', whereParams);
  const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
  return db.all(
    `SELECT s.id AS storeId,
            s.name AS storeName,
            COUNT(r.id) AS count
     FROM stores s
     LEFT JOIN reminders r ON r.store_id = s.id
       AND r.handled_at IS NULL
       AND ${windowSql}
     WHERE 1=1 ${scope} ${storeScope}
     GROUP BY s.id
     ORDER BY count DESC, s.id ASC
     LIMIT ?`,
    ...joinParams,
    ...whereParams,
    normalizedLimit
  );
}

// Builds the date-window clause for a trend query: [from, to] when given,
// otherwise the historical "last N days" default.
function trendWindowClause(dateExpr, { from, to, days }, params) {
  const clauses = [];
  if (from || to) {
    if (from) {
      clauses.push(`datetime(${dateExpr}) >= datetime(?)`);
      params.push(from);
    }
    if (to) {
      clauses.push(`datetime(${dateExpr}) <= datetime(?)`);
      params.push(to);
    }
  } else {
    clauses.push(`datetime(${dateExpr}) >= datetime('now', ?)`);
    params.push(`-${days} day`);
  }
  return clauses.map((clause) => `AND ${clause}`).join('\n       ');
}

async function getLossTrend(db, { brandId, storeId, from, to, days = 30 } = {}) {
  const filters = normalizeDashboardFilters({ storeId, from, to });
  const normalizedDays = Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  const params = [];
  const scope = brandScopeClause(brandId, 's', params);
  const storeScope = storeIdClause(filters.storeId, 's', params);
  const windowSql = trendWindowClause('r.expires_at', { ...filters, days: normalizedDays }, params);
  return db.all(
    `SELECT date(r.expires_at) AS date,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN datetime(r.expires_at) < datetime('now') AND r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS handled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE 1=1 ${scope} ${storeScope}
       ${windowSql}
     GROUP BY date(r.expires_at)
     ORDER BY date(r.expires_at) ASC`,
    ...params
  );
}

async function getInspectionScoreTrend(db, { brandId, storeId, from, to, days = 30 } = {}) {
  const filters = normalizeDashboardFilters({ storeId, from, to });
  const normalizedDays = Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  const params = [];
  const scope = brandScopeClause(brandId, 's', params);
  const storeScope = storeIdClause(filters.storeId, 's', params);
  const windowSql = trendWindowClause('COALESCE(i.completed_at, i.created_at)', { ...filters, days: normalizedDays }, params);
  return db.all(
    `SELECT date(COALESCE(i.completed_at, i.created_at)) AS date,
            AVG(
              CASE
                WHEN i.score_pct IS NOT NULL THEN i.score_pct
                WHEN i.max_score > 0 THEN (i.total_score * 100.0 / i.max_score)
                ELSE NULL
              END
            ) AS avgScore,
            COUNT(*) AS count
     FROM inspections i
     JOIN stores s ON s.id = i.store_id
     WHERE 1=1 ${scope} ${storeScope}
       ${windowSql}
     GROUP BY date(COALESCE(i.completed_at, i.created_at))
     ORDER BY date(COALESCE(i.completed_at, i.created_at)) ASC`,
    ...params
  );
}

// ─── P2-5: store ranking drilldown ────────────────────────────────────────────
// One row per store in scope:
//   handleRate         = handled reminders / total reminders (expires_at in window)
//   wasteRate          = same口径 as the waste report: distinct batches with a
//                        'discarded' handling log (handled in window) / batches
//                        printed in window
//   avgInspectionScore = AVG score percentage of inspections in window (null
//                        when the store has none)
//   openIssues         = issues not yet resolved/closed
//   overdueIssues      = open issues whose due_date is in the past
async function getStoreDashboardRanking(db, { brandId, from, to } = {}) {
  const filters = normalizeDashboardFilters({ from, to });

  const buildQuery = (sql, dateColumn) => {
    const params = [];
    const scope = brandScopeClause(brandId, 's', params);
    let windowSql = '';
    if (dateColumn) {
      if (filters.from) {
        windowSql += `\n       AND datetime(${dateColumn}) >= datetime(?)`;
        params.push(filters.from);
      }
      if (filters.to) {
        windowSql += `\n       AND datetime(${dateColumn}) <= datetime(?)`;
        params.push(filters.to);
      }
    }
    return db.all(sql.replace('__SCOPE__', scope).replace('__WINDOW__', windowSql), ...params);
  };

  const stores = await buildQuery(
    `SELECT s.id AS storeId, s.name AS storeName
     FROM stores s
     WHERE 1=1 __SCOPE__ __WINDOW__
     ORDER BY s.id ASC`,
    null
  );

  const reminderRows = await buildQuery(
    `SELECT r.store_id AS storeId,
            COUNT(*) AS total,
            SUM(CASE WHEN r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS handled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE 1=1 __SCOPE__ __WINDOW__
     GROUP BY r.store_id`,
    'r.expires_at'
  );

  const batchRows = await buildQuery(
    `SELECT b.store_id AS storeId, COUNT(*) AS totalBatches
     FROM batches b
     JOIN stores s ON s.id = b.store_id
     WHERE 1=1 __SCOPE__ __WINDOW__
     GROUP BY b.store_id`,
    'b.printed_at'
  );

  const discardRows = await buildQuery(
    `SELECT hl.store_id AS storeId, COUNT(DISTINCT r.batch_id) AS discardedCount
     FROM handling_logs hl
     JOIN reminders r ON r.id = hl.reminder_id
     JOIN stores s ON s.id = hl.store_id
     WHERE hl.reason = 'discarded' __SCOPE__ __WINDOW__
     GROUP BY hl.store_id`,
    'hl.handled_at'
  );

  const inspectionRows = await buildQuery(
    `SELECT i.store_id AS storeId,
            AVG(
              CASE
                WHEN i.score_pct IS NOT NULL THEN i.score_pct
                WHEN i.max_score > 0 THEN (i.total_score * 100.0 / i.max_score)
                ELSE NULL
              END
            ) AS avgScore
     FROM inspections i
     JOIN stores s ON s.id = i.store_id
     WHERE 1=1 __SCOPE__ __WINDOW__
     GROUP BY i.store_id`,
    'COALESCE(i.completed_at, i.created_at)'
  );

  const issueRows = await buildQuery(
    `SELECT issues.store_id AS storeId,
            SUM(CASE WHEN issues.status NOT IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS openIssues,
            SUM(CASE WHEN issues.status NOT IN ('resolved', 'closed')
                     AND issues.due_date IS NOT NULL
                     AND datetime(issues.due_date) < datetime('now') THEN 1 ELSE 0 END) AS overdueIssues
     FROM issues
     JOIN stores s ON s.id = issues.store_id
     WHERE 1=1 __SCOPE__ __WINDOW__
     GROUP BY issues.store_id`,
    null
  );

  const indexBy = (rows) => new Map(rows.map((row) => [row.storeId, row]));
  const reminders = indexBy(reminderRows);
  const batches = indexBy(batchRows);
  const discards = indexBy(discardRows);
  const inspections = indexBy(inspectionRows);
  const issues = indexBy(issueRows);

  return stores.map((store) => {
    const reminder = reminders.get(store.storeId);
    const total = Number(reminder?.total || 0);
    const handled = Number(reminder?.handled || 0);
    const totalBatches = Number(batches.get(store.storeId)?.totalBatches || 0);
    const discardedCount = Number(discards.get(store.storeId)?.discardedCount || 0);
    const avgScore = inspections.get(store.storeId)?.avgScore;
    const issueRow = issues.get(store.storeId);
    return {
      storeId: store.storeId,
      storeName: store.storeName,
      handleRate: total > 0 ? handled / total : 0,
      wasteRate: totalBatches > 0 ? discardedCount / totalBatches : 0,
      avgInspectionScore: avgScore != null ? Math.round(avgScore * 10) / 10 : null,
      openIssues: Number(issueRow?.openIssues || 0),
      overdueIssues: Number(issueRow?.overdueIssues || 0)
    };
  });
}

module.exports = {
  brandScopeClause,
  normalizeDashboardFilters,
  storeIdClause,
  getDashboardSummary,
  getStoreExpiryRanking,
  trendWindowClause,
  getLossTrend,
  getInspectionScoreTrend,
  getStoreDashboardRanking
};

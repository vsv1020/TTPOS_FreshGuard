/**
 * P2-1: 「日管控·周排查·月调度」compliance reports (市场监管总局《企业落实食品安全
 * 主体责任监督管理规定》). Reports are generated on the fly from existing data
 * (inspections, reminders, handling_logs, issues, pin_attempts) and are never
 * persisted. The three report types share one shape:
 *   { type, <period fields>, brand, store, sections, risks, generatedAt }
 * with sections: [{ title, items: [{ label, value, status }] }] and
 * risks: [{ description, severity, suggestion }]. Field copy is Chinese — the
 * output is meant to be shown to regulators. Stores with no data still render
 * (values 0 / 「无」), never an error.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function requireDateString(value, name) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  return normalized;
}

function requireMonthString(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}-01T00:00:00Z`))) {
    throw new Error('month must be a valid YYYY-MM month');
  }
  return normalized;
}

function dayStartIso(date) {
  return `${date}T00:00:00.000Z`;
}

function addDays(date, days) {
  return new Date(Date.parse(dayStartIso(date)) + days * DAY_MS).toISOString().slice(0, 10);
}

function rateStatus(rate) {
  if (rate >= 0.8) return 'ok';
  if (rate >= 0.5) return 'warning';
  return 'fail';
}

function scoreStatus(score) {
  if (score >= 85) return 'ok';
  if (score >= 60) return 'warning';
  return 'fail';
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

// ─── shared aggregation ───────────────────────────────────────────────────────

// Builds "AND ..." scope SQL for queries that join stores under alias `s`.
function storeScope(brandId, storeId, params) {
  let sql = '';
  if (brandId != null) {
    sql += ' AND s.brand_id = ?';
    params.push(brandId);
  }
  if (storeId != null) {
    sql += ' AND s.id = ?';
    params.push(storeId);
  }
  return sql;
}

const INSPECTION_SCORE_SQL = `AVG(
  CASE
    WHEN i.score_pct IS NOT NULL THEN i.score_pct
    WHEN i.max_score > 0 THEN (i.total_score * 100.0 / i.max_score)
    ELSE NULL
  END
)`;

async function getAvgInspectionScore(db, { brandId, storeId, fromIso, toIso }) {
  const params = [fromIso, toIso];
  const scope = storeScope(brandId, storeId, params);
  const row = await db.get(
    `SELECT ${INSPECTION_SCORE_SQL} AS avgScore
     FROM inspections i
     JOIN stores s ON s.id = i.store_id
     WHERE datetime(COALESCE(i.completed_at, i.created_at)) >= datetime(?)
       AND datetime(COALESCE(i.completed_at, i.created_at)) < datetime(?)
       ${scope}`,
    ...params
  );
  return row?.avgScore != null ? Math.round(row.avgScore * 10) / 10 : null;
}

// Collects every aggregate the three reports need for [fromIso, toIso).
async function collectComplianceStats(db, { brandId, storeId, fromIso, toIso }) {
  const nowIso = new Date().toISOString();
  // "Expired and unhandled" is cumulative as of the end of the period, but a
  // reminder expiring later today must not count as expired yet.
  const expiryCutoff = toIso < nowIso ? toIso : nowIso;

  const inspectionParams = [fromIso, toIso];
  const inspectionScope = storeScope(brandId, storeId, inspectionParams);
  const inspectionRow = await db.get(
    `SELECT SUM(CASE WHEN i.status IN ('submitted', 'reviewed', 'completed') THEN 1 ELSE 0 END) AS completed,
            ${INSPECTION_SCORE_SQL} AS avgScore
     FROM inspections i
     JOIN stores s ON s.id = i.store_id
     WHERE datetime(COALESCE(i.completed_at, i.created_at)) >= datetime(?)
       AND datetime(COALESCE(i.completed_at, i.created_at)) < datetime(?)
       ${inspectionScope}`,
    ...inspectionParams
  );

  const reminderParams = [fromIso, toIso];
  const reminderScope = storeScope(brandId, storeId, reminderParams);
  const reminderRow = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN r.handled_at IS NOT NULL THEN 1 ELSE 0 END) AS handled
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE datetime(r.expires_at) >= datetime(?)
       AND datetime(r.expires_at) < datetime(?)
       ${reminderScope}`,
    ...reminderParams
  );

  const expiredParams = [expiryCutoff];
  const expiredScope = storeScope(brandId, storeId, expiredParams);
  const expiredRow = await db.get(
    `SELECT COUNT(*) AS c
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     WHERE r.handled_at IS NULL
       AND datetime(r.expires_at) < datetime(?)
       ${expiredScope}`,
    ...expiredParams
  );
  const expiredTop = await db.all(
    `SELECT p.name AS productName, s.name AS storeName, r.expires_at AS expiresAt
     FROM reminders r
     JOIN stores s ON s.id = r.store_id
     JOIN products p ON p.id = r.product_id
     WHERE r.handled_at IS NULL
       AND datetime(r.expires_at) < datetime(?)
       ${expiredScope}
     ORDER BY datetime(r.expires_at) ASC
     LIMIT 5`,
    ...expiredParams
  );

  const batchParams = [fromIso, toIso];
  const batchScope = storeScope(brandId, storeId, batchParams);
  const batchRow = await db.get(
    `SELECT COUNT(*) AS c
     FROM batches b
     JOIN stores s ON s.id = b.store_id
     WHERE datetime(b.printed_at) >= datetime(?)
       AND datetime(b.printed_at) < datetime(?)
       ${batchScope}`,
    ...batchParams
  );

  const reasonParams = [fromIso, toIso];
  const reasonScope = storeScope(brandId, storeId, reasonParams);
  const reasonRows = await db.all(
    `SELECT hl.reason AS reason, COUNT(*) AS count
     FROM handling_logs hl
     JOIN stores s ON s.id = hl.store_id
     WHERE datetime(hl.handled_at) >= datetime(?)
       AND datetime(hl.handled_at) < datetime(?)
       ${reasonScope}
     GROUP BY hl.reason`,
    ...reasonParams
  );
  const byReason = { discarded: 0, sold: 0, transferred: 0, discounted: 0 };
  for (const row of reasonRows) {
    byReason[row.reason] = Number(row.count || 0);
  }

  const pinParams = [fromIso, toIso];
  const pinScope = storeScope(brandId, storeId, pinParams);
  const pinRow = await db.get(
    `SELECT COUNT(*) AS c
     FROM pin_attempts pa
     JOIN stores s ON s.id = pa.store_id
     WHERE pa.locked_until IS NOT NULL
       AND datetime(pa.updated_at) >= datetime(?)
       AND datetime(pa.updated_at) < datetime(?)
       ${pinScope}`,
    ...pinParams
  );

  const issueCreatedParams = [fromIso, toIso];
  const issueCreatedScope = storeScope(brandId, storeId, issueCreatedParams);
  const issueCreatedRow = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN issues.status IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS resolved
     FROM issues
     JOIN stores s ON s.id = issues.store_id
     WHERE datetime(issues.created_at) >= datetime(?)
       AND datetime(issues.created_at) < datetime(?)
       ${issueCreatedScope}`,
    ...issueCreatedParams
  );

  const openIssueParams = [];
  const openIssueScope = storeScope(brandId, storeId, openIssueParams);
  const openIssueRow = await db.get(
    `SELECT SUM(CASE WHEN issues.status NOT IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN issues.status NOT IN ('resolved', 'closed')
                     AND issues.due_date IS NOT NULL
                     AND datetime(issues.due_date) < datetime('now') THEN 1 ELSE 0 END) AS overdue
     FROM issues
     JOIN stores s ON s.id = issues.store_id
     WHERE 1=1 ${openIssueScope}`,
    ...openIssueParams
  );
  const overdueIssueList = await db.all(
    `SELECT issues.title AS title, issues.severity AS severity,
            issues.due_date AS dueDate, s.name AS storeName
     FROM issues
     JOIN stores s ON s.id = issues.store_id
     WHERE issues.status NOT IN ('resolved', 'closed')
       AND issues.due_date IS NOT NULL
       AND datetime(issues.due_date) < datetime('now')
       ${openIssueScope}
     ORDER BY datetime(issues.due_date) ASC
     LIMIT 5`,
    ...openIssueParams
  );

  const total = Number(reminderRow?.total || 0);
  const handled = Number(reminderRow?.handled || 0);

  return {
    inspectionCompleted: Number(inspectionRow?.completed || 0),
    avgInspectionScore: inspectionRow?.avgScore != null
      ? Math.round(inspectionRow.avgScore * 10) / 10
      : null,
    printedBatches: Number(batchRow?.c || 0),
    reminderTotal: total,
    reminderHandled: handled,
    handleRate: total > 0 ? handled / total : null,
    expiredUnhandled: Number(expiredRow?.c || 0),
    expiredUnhandledTop: expiredTop,
    byReason,
    pinLockCount: Number(pinRow?.c || 0),
    issuesCreated: Number(issueCreatedRow?.total || 0),
    issuesCreatedResolved: Number(issueCreatedRow?.resolved || 0),
    openIssues: Number(openIssueRow?.open || 0),
    overdueIssues: Number(openIssueRow?.overdue || 0),
    overdueIssueList
  };
}

// ─── sections & risks ─────────────────────────────────────────────────────────

function inspectionSection(stats, titlePrefix) {
  return {
    title: `${titlePrefix}·食品安全检查`,
    items: [
      {
        label: '巡检完成情况',
        value: `${stats.inspectionCompleted} 次`,
        status: stats.inspectionCompleted > 0 ? 'ok' : 'warning'
      },
      {
        label: '巡检平均得分',
        value: stats.avgInspectionScore != null ? stats.avgInspectionScore : '无',
        status: stats.avgInspectionScore != null ? scoreStatus(stats.avgInspectionScore) : 'warning'
      }
    ]
  };
}

function expirySection(stats) {
  return {
    title: '效期与临期食品处理',
    items: [
      { label: '打印批次数', value: stats.printedBatches, status: 'ok' },
      {
        label: '临期食品处理率',
        value: stats.handleRate != null ? formatRate(stats.handleRate) : '无',
        status: stats.handleRate != null ? rateStatus(stats.handleRate) : 'ok'
      },
      {
        label: '过期未处理批次',
        value: stats.expiredUnhandled,
        status: stats.expiredUnhandled > 0 ? 'fail' : 'ok'
      },
      { label: '报损（废弃）数量', value: stats.byReason.discarded, status: 'ok' },
      { label: '转促销售出数量', value: stats.byReason.discounted, status: 'ok' }
    ]
  };
}

function safetySection(stats) {
  return {
    title: '人员与系统安全',
    items: [
      {
        label: '员工 PIN 异常锁定',
        value: `${stats.pinLockCount} 次`,
        status: stats.pinLockCount > 0 ? 'warning' : 'ok'
      }
    ]
  };
}

function issueSection(stats) {
  return {
    title: '风险隐患排查治理',
    items: [
      { label: '新增问题数', value: stats.issuesCreated, status: 'ok' },
      {
        label: '未关闭问题数',
        value: stats.openIssues,
        status: stats.openIssues > 0 ? 'warning' : 'ok'
      },
      {
        label: '逾期未整改问题数',
        value: stats.overdueIssues,
        status: stats.overdueIssues > 0 ? 'fail' : 'ok'
      }
    ]
  };
}

function issueRiskSeverity(severity) {
  if (severity === 'critical' || severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

function buildRisks(stats, { includeIssueRisks = false } = {}) {
  const risks = [];

  if (stats.expiredUnhandled > 0) {
    const examples = stats.expiredUnhandledTop
      .map((row) => `${row.productName}（${row.storeName}）`)
      .join('、');
    risks.push({
      description: `${stats.expiredUnhandled} 个过期批次未处理${examples ? `，如：${examples}` : ''}`,
      severity: 'high',
      suggestion: '立即下架并按规范处置过期食品，做好处置记录'
    });
  }
  if (stats.inspectionCompleted === 0) {
    risks.push({
      description: '期间未完成任何食品安全巡检/自检',
      severity: 'medium',
      suggestion: '按「日管控」制度要求每日开展并记录食品安全自查'
    });
  }
  if (stats.avgInspectionScore != null && stats.avgInspectionScore < 60) {
    risks.push({
      description: `巡检平均得分偏低（${stats.avgInspectionScore} 分）`,
      severity: 'high',
      suggestion: '针对低分检查项制定整改措施并复查验收'
    });
  }
  if (stats.handleRate != null && stats.handleRate < 0.8) {
    risks.push({
      description: `临期食品处理率偏低（${formatRate(stats.handleRate)}）`,
      severity: 'medium',
      suggestion: '加强临期食品巡查频次，确保到期前完成处置'
    });
  }
  if (stats.pinLockCount > 0) {
    risks.push({
      description: `期间发生 ${stats.pinLockCount} 次员工 PIN 异常锁定`,
      severity: 'medium',
      suggestion: '核实是否存在 PIN 泄露或违规代操作，必要时重置 PIN'
    });
  }
  if (includeIssueRisks) {
    for (const issue of stats.overdueIssueList) {
      risks.push({
        description: `整改逾期：${issue.title}（${issue.storeName || '未知门店'}，期限 ${issue.dueDate}）`,
        severity: issueRiskSeverity(issue.severity),
        suggestion: '督促责任人限期完成整改并闭环验收'
      });
    }
  }
  return risks;
}

// Resolves the brand/store display blocks for the report header. Throws when a
// given brandId/storeId does not exist (the route maps it to 404).
async function resolveReportScope(db, { brandId, storeId }) {
  let store = null;
  let brand = null;
  if (storeId != null) {
    const row = await db.get(
      `SELECT s.id, s.name, s.brand_id AS brandId, b.name AS brandName
       FROM stores s
       JOIN brands b ON b.id = s.brand_id
       WHERE s.id = ?`,
      storeId
    );
    if (!row) {
      throw new Error('storeId not found');
    }
    store = { id: row.id, name: row.name };
    brand = { id: row.brandId, name: row.brandName };
  }
  if (brandId != null) {
    const row = await db.get('SELECT id, name FROM brands WHERE id = ?', brandId);
    if (!row) {
      throw new Error('brandId not found');
    }
    brand = { id: row.id, name: row.name };
  }
  return { brand, store };
}

// ─── report builders ──────────────────────────────────────────────────────────

async function buildDailyComplianceReport(db, { date, brandId, storeId } = {}) {
  const normalizedDate = date != null && date !== ''
    ? requireDateString(date, 'date')
    : new Date().toISOString().slice(0, 10);
  const fromIso = dayStartIso(normalizedDate);
  const toIso = dayStartIso(addDays(normalizedDate, 1));

  const scope = await resolveReportScope(db, { brandId, storeId });
  const stats = await collectComplianceStats(db, { brandId, storeId, fromIso, toIso });

  return {
    type: 'daily',
    date: normalizedDate,
    period: { from: fromIso, to: toIso },
    ...scope,
    sections: [
      inspectionSection(stats, '日管控'),
      expirySection(stats),
      safetySection(stats)
    ],
    risks: buildRisks(stats),
    generatedAt: new Date().toISOString()
  };
}

async function buildWeeklyComplianceReport(db, { weekStart, brandId, storeId } = {}) {
  const normalizedStart = weekStart != null && weekStart !== ''
    ? requireDateString(weekStart, 'weekStart')
    : addDays(new Date().toISOString().slice(0, 10), -6);
  const fromIso = dayStartIso(normalizedStart);
  const toIso = dayStartIso(addDays(normalizedStart, 7));

  const scope = await resolveReportScope(db, { brandId, storeId });
  const stats = await collectComplianceStats(db, { brandId, storeId, fromIso, toIso });

  return {
    type: 'weekly',
    weekStart: normalizedStart,
    weekEnd: addDays(normalizedStart, 6),
    period: { from: fromIso, to: toIso },
    ...scope,
    sections: [
      inspectionSection(stats, '周排查'),
      expirySection(stats),
      safetySection(stats),
      issueSection(stats)
    ],
    risks: buildRisks(stats, { includeIssueRisks: true }),
    generatedAt: new Date().toISOString()
  };
}

async function buildMonthlyComplianceReport(db, { month, brandId, storeId } = {}) {
  const normalizedMonth = month != null && month !== ''
    ? requireMonthString(month)
    : new Date().toISOString().slice(0, 7);
  const [year, monthNum] = normalizedMonth.split('-').map(Number);
  const fromIso = new Date(Date.UTC(year, monthNum - 1, 1)).toISOString();
  const toIso = new Date(Date.UTC(year, monthNum, 1)).toISOString();

  const scope = await resolveReportScope(db, { brandId, storeId });
  const stats = await collectComplianceStats(db, { brandId, storeId, fromIso, toIso });

  // Score trend: first half of the month vs second half.
  const midIso = new Date(
    Date.parse(fromIso) + Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 2)
  ).toISOString();
  const firstHalfScore = await getAvgInspectionScore(db, { brandId, storeId, fromIso, toIso: midIso });
  const secondHalfScore = await getAvgInspectionScore(db, { brandId, storeId, fromIso: midIso, toIso });
  const trendValue = firstHalfScore != null || secondHalfScore != null
    ? `上半月 ${firstHalfScore != null ? firstHalfScore : '无'} → 下半月 ${secondHalfScore != null ? secondHalfScore : '无'}`
    : '无';
  const trendDeclined = firstHalfScore != null && secondHalfScore != null && secondHalfScore < firstHalfScore;

  // Top risk stores (only meaningful brand/platform-wide; skipped when the
  // report is already narrowed to one store).
  let riskStoresValue = '无';
  if (storeId == null) {
    const params = [toIso < new Date().toISOString() ? toIso : new Date().toISOString()];
    let scopeSql = '';
    if (brandId != null) {
      scopeSql = ' AND s.brand_id = ?';
      params.push(brandId);
    }
    const riskStores = await db.all(
      `SELECT name, expiredUnhandled, overdueIssues
       FROM (
         SELECT s.id AS id,
                s.name AS name,
                (SELECT COUNT(*) FROM reminders r
                 WHERE r.store_id = s.id AND r.handled_at IS NULL
                   AND datetime(r.expires_at) < datetime(?)) AS expiredUnhandled,
                (SELECT COUNT(*) FROM issues
                 WHERE issues.store_id = s.id
                   AND issues.status NOT IN ('resolved', 'closed')
                   AND issues.due_date IS NOT NULL
                   AND datetime(issues.due_date) < datetime('now')) AS overdueIssues
         FROM stores s
         WHERE 1=1 ${scopeSql}
       )
       ORDER BY (expiredUnhandled + overdueIssues) DESC, id ASC
       LIMIT 3`,
      ...params
    );
    const flagged = riskStores.filter((row) => Number(row.expiredUnhandled) + Number(row.overdueIssues) > 0);
    if (flagged.length > 0) {
      riskStoresValue = flagged
        .map((row) => `${row.name}（过期未处理 ${row.expiredUnhandled}，整改逾期 ${row.overdueIssues}）`)
        .join('；');
    }
  }

  const rectificationRate = stats.issuesCreated > 0
    ? stats.issuesCreatedResolved / stats.issuesCreated
    : null;

  return {
    type: 'monthly',
    month: normalizedMonth,
    period: { from: fromIso, to: toIso },
    ...scope,
    sections: [
      inspectionSection(stats, '月调度'),
      expirySection(stats),
      safetySection(stats),
      issueSection(stats),
      {
        title: '月度调度与整改',
        items: [
          {
            label: '整改完成率',
            value: rectificationRate != null ? formatRate(rectificationRate) : '无',
            status: rectificationRate != null ? rateStatus(rectificationRate) : 'ok'
          },
          {
            label: '巡检得分趋势',
            value: trendValue,
            status: trendDeclined ? 'warning' : 'ok'
          },
          {
            label: 'Top 风险门店',
            value: riskStoresValue,
            status: riskStoresValue === '无' ? 'ok' : 'warning'
          }
        ]
      }
    ],
    risks: buildRisks(stats, { includeIssueRisks: true }),
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildDailyComplianceReport,
  buildWeeklyComplianceReport,
  buildMonthlyComplianceReport
};

const express = require('express');
const { listInspections } = require('../inspection-db');
const {
  buildDailyComplianceReport,
  buildMonthlyComplianceReport,
  buildWeeklyComplianceReport
} = require('../compliance');
const {
  getWasteReport,
  listAuditLogs,
  listExpiredHandlingReport
} = require('../db');
const { respondDataError, sendList, sendCsv, makeAssertStoreInScope } = require('../lib/http');

function buildAdminReportsRoutes({ db, adminApiAuth }) {
  const router = express.Router();
  const assertStoreInScope = makeAssertStoreInScope(db);

  router.get('/api/admin/reports/expired-handling', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const result = await listExpiredHandlingReport(db, {
        brandId,
        startDate: req.query.startDate != null ? req.query.startDate : req.query.from,
        endDate: req.query.endDate != null ? req.query.endDate : req.query.to,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      const rows = Array.isArray(result) ? result : result.items;

      if (req.query.format === 'csv') {
        return sendCsv(
          res,
          'expired-handling.csv',
          [
            { key: 'storeId', label: 'Store ID' },
            { key: 'storeName', label: 'Store Name' },
            { key: 'productId', label: 'Product ID' },
            { key: 'productName', label: 'Product Name' },
            { key: 'expiredTotalCount', label: 'Expired Total' },
            { key: 'expiredHandledCount', label: 'Expired Handled' },
            { key: 'expiredUnhandledCount', label: 'Expired Unhandled' },
            { key: 'discardedCount', label: 'Discarded' },
            { key: 'soldCount', label: 'Sold' },
            { key: 'transferredCount', label: 'Transferred' }
          ],
          rows
        );
      }

      if (!Array.isArray(result)) {
        return res.json(result);
      }
      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-3: waste dashboard. Brand-scoped admins are automatically narrowed to
  // their own brand; platform admins may pass brandId/storeId filters.
  router.get('/api/admin/reports/waste', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : (req.query.brandId || undefined);
      const report = await getWasteReport(db, {
        brandId,
        storeId: req.query.storeId,
        from: req.query.from,
        to: req.query.to
      });
      return res.json(report);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/reports/inspections', adminApiAuth, async (req, res) => {
    try {
      const hasLimit = req.query.limit != null && req.query.limit !== '' && req.query.format !== 'csv';
      const result = await listInspections(db, {
        storeId: req.query.storeId,
        templateId: req.query.templateId,
        status: req.query.status,
        q: req.query.q,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : 0,
        includeTotal: hasLimit
      });
      const rows = Array.isArray(result) ? result : result.items;

      if (req.query.format === 'csv') {
        return sendCsv(
          res,
          'inspections.csv',
          [
            { key: 'id', label: 'ID' },
            { key: 'template_name', label: 'Template' },
            { key: 'store_name', label: 'Store' },
            { key: 'type', label: 'Type' },
            { key: 'status', label: 'Status' },
            { key: 'total_score', label: 'Total Score' },
            { key: 'max_score', label: 'Max Score' },
            { key: 'grade', label: 'Grade' },
            { key: 'score_pct', label: 'Score %' },
            { key: 'completed_at', label: 'Completed At' },
            { key: 'created_at', label: 'Created At' }
          ],
          rows
        );
      }

      if (!Array.isArray(result)) {
        return res.json(result);
      }
      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/audit-logs', adminApiAuth, async (req, res) => {
    try {
      // Brand-scoped admins only read their own brand's trail; platform admins see all.
      const result = await listAuditLogs(db, {
        brandId: req.admin.brandId != null ? req.admin.brandId : undefined,
        actor: req.query.actor,
        action: req.query.action,
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'logs', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // ─── P2-1: 「日管控·周排查·月调度」compliance reports ─────────────────────
  // Generated live for regulators (中文 copy); brand admins are auto-narrowed,
  // and a requested storeId must be inside the admin's brand scope.
  async function resolveComplianceScope(req, res) {
    const brandId = req.admin.brandId != null ? req.admin.brandId : (req.query.brandId || undefined);
    let storeId;
    if (req.query.storeId != null && req.query.storeId !== '') {
      const store = await assertStoreInScope(req, res, req.query.storeId);
      if (!store) return null;
      storeId = store.id;
    }
    return { brandId, storeId };
  }

  router.get('/api/admin/compliance/daily', adminApiAuth, async (req, res) => {
    try {
      const scope = await resolveComplianceScope(req, res);
      if (!scope) return undefined;
      const report = await buildDailyComplianceReport(db, { date: req.query.date, ...scope });
      return res.json(report);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/compliance/weekly', adminApiAuth, async (req, res) => {
    try {
      const scope = await resolveComplianceScope(req, res);
      if (!scope) return undefined;
      const report = await buildWeeklyComplianceReport(db, { weekStart: req.query.weekStart, ...scope });
      return res.json(report);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/compliance/monthly', adminApiAuth, async (req, res) => {
    try {
      const scope = await resolveComplianceScope(req, res);
      if (!scope) return undefined;
      const report = await buildMonthlyComplianceReport(db, { month: req.query.month, ...scope });
      return res.json(report);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminReportsRoutes };

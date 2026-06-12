const express = require('express');
const {
  getDashboardSummary,
  getInspectionScoreTrend,
  getLossTrend,
  getStoreDashboardRanking,
  getStoreExpiryRanking
} = require('../db');
const { respondDataError } = require('../lib/http');

function buildAdminDashboardRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  // ─── Feature B: Dashboard aggregation ───────────────────────────────────
  // P2-5 drilldown: every endpoint accepts from/to/brandId/storeId. Brand
  // admins are always narrowed to their own brand (query brandId ignored).

  function resolveDashboardScope(req) {
    return {
      brandId: req.admin.brandId != null ? req.admin.brandId : (req.query.brandId || undefined),
      storeId: req.query.storeId,
      from: req.query.from,
      to: req.query.to
    };
  }

  router.get('/api/admin/dashboard/summary', adminApiAuth, async (req, res) => {
    try {
      const summary = await getDashboardSummary(db, resolveDashboardScope(req));
      return res.json({ summary });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/dashboard/ranking', adminApiAuth, async (req, res) => {
    try {
      const ranking = await getStoreExpiryRanking(db, {
        ...resolveDashboardScope(req),
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });
      return res.json({ ranking });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/dashboard/loss-trend', adminApiAuth, async (req, res) => {
    try {
      const trend = await getLossTrend(db, {
        ...resolveDashboardScope(req),
        days: req.query.days ? Number(req.query.days) : undefined
      });
      return res.json({ trend });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/dashboard/score-trend', adminApiAuth, async (req, res) => {
    try {
      const trend = await getInspectionScoreTrend(db, {
        ...resolveDashboardScope(req),
        days: req.query.days ? Number(req.query.days) : undefined
      });
      return res.json({ trend });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P2-5: per-store ranking (handleRate / wasteRate / avgInspectionScore /
  // openIssues / overdueIssues). Brand admins are auto-narrowed.
  router.get('/api/admin/dashboard/store-ranking', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : (req.query.brandId || undefined);
      const items = await getStoreDashboardRanking(db, {
        brandId,
        from: req.query.from,
        to: req.query.to
      });
      return res.json({ items });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminDashboardRoutes };

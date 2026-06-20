const express = require('express');
const {
  getConnection,
  upsertConnection,
  getSelections,
  setSelections,
  fetchItemGroups,
  previewSync,
  runSync,
  recordAudit
} = require('../db');
const { respondDataError } = require('../lib/http');

function buildAdminErpRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  // Brand-scope guard. req.params.brandId is a STRING; the JWT claim is an
  // integer — cast the param before comparing or every legit brand_admin
  // request is rejected. Returns false when allowed, true after responding 403.
  function denyBrandScope(req, res) {
    if (req.admin.brandId != null && parseInt(req.params.brandId, 10) !== req.admin.brandId) {
      res.status(403).json({ error: 'Forbidden' });
      return true;
    }
    return false;
  }

  // GET config (masked: never returns the secret; has_secret flags presence).
  router.get('/api/admin/erp/:brandId', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const connection = await getConnection(db, req.params.brandId);
      return res.json({ connection });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.put('/api/admin/erp/:brandId', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const connection = await upsertConnection(db, req.params.brandId, {
        baseUrl: req.body?.baseUrl,
        apiKey: req.body?.apiKey,
        apiSecret: req.body?.apiSecret,
        enabled: req.body?.enabled,
        defaultLabelLanguage: req.body?.defaultLabelLanguage,
        defaultPrimaryLanguage: req.body?.defaultPrimaryLanguage,
        defaultSecondaryLanguage: req.body?.defaultSecondaryLanguage,
        defaultShelfLifeDays: req.body?.defaultShelfLifeDays
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'erp.config.update',
        targetType: 'brand',
        targetId: connection.brandId,
        detail: `baseUrl=${connection.baseUrl} enabled=${connection.enabled}`,
        ip: req.ip,
        brandId: connection.brandId
      });
      return res.json({ connection });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // Connectivity test: a single Item Group fetch exercises the credentials.
  router.post('/api/admin/erp/:brandId/test', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const groups = await fetchItemGroups(db, req.params.brandId);
      return res.json({ ok: true, itemGroupCount: groups.length });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/erp/:brandId/item-groups', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const itemGroups = await fetchItemGroups(db, req.params.brandId);
      return res.json({ itemGroups });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/erp/:brandId/categories', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const selections = await getSelections(db, req.params.brandId);
      return res.json({ selections });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.put('/api/admin/erp/:brandId/categories', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const selections = await setSelections(db, req.params.brandId, req.body?.itemGroups);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'erp.categories.update',
        targetType: 'brand',
        targetId: parseInt(req.params.brandId, 10),
        detail: `count=${selections.length}`,
        ip: req.ip,
        brandId: parseInt(req.params.brandId, 10)
      });
      return res.json({ selections });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/erp/:brandId/preview', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const preview = await previewSync(db, req.params.brandId);
      return res.json({ preview });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/erp/:brandId/sync', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const result = await runSync(db, req.params.brandId, { email: req.admin.email });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'erp.sync',
        targetType: 'brand',
        targetId: parseInt(req.params.brandId, 10),
        detail: result.detail,
        ip: req.ip,
        brandId: parseInt(req.params.brandId, 10)
      });
      return res.json({ result });
    } catch (error) {
      if (error && error.code === 'SYNC_RUNNING') {
        return res.status(409).json({ error: error.message });
      }
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/erp/:brandId/status', adminApiAuth, async (req, res) => {
    try {
      if (denyBrandScope(req, res)) {
        return undefined;
      }
      const connection = await getConnection(db, req.params.brandId);
      if (!connection) {
        return res.json({ status: null });
      }
      return res.json({
        status: {
          lastSyncAt: connection.lastSyncAt,
          lastSyncStatus: connection.lastSyncStatus,
          lastSyncDetail: connection.lastSyncDetail
        }
      });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminErpRoutes };

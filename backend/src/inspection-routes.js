/**
 * Inspection module API routes.
 * Mounts under /api/admin/inspection/* and /api/store/inspection/*
 */

const express = require('express');
const {
  createTemplate, listTemplates, getTemplate, updateTemplate, deleteTemplate,
  addCheckItem, updateCheckItem, deleteCheckItem,
  createInspection, submitInspectionResults, listInspections, getInspection,
  createIssue, updateIssue, listIssues,
  createSelfCheck, submitSelfCheckResults,
  getInspectionScorecard, getStoreScoreHistory,
} = require('./inspection-db');
const { recordAudit } = require('./db');

function respondError(res, error) {
  const msg = String(error?.message || 'Request failed');
  if (msg.includes('not found')) return res.status(404).json({ error: msg });
  if (msg.includes('required')) return res.status(400).json({ error: msg });
  return res.status(400).json({ error: msg });
}

function buildInspectionRoutes({ db, adminAuth, storeAuth }) {
  const router = express.Router();

  // Resolve a store's brand id for audit brand scoping (null when unknown).
  async function getStoreBrandId(storeId) {
    if (storeId == null) return null;
    const row = await db.get('SELECT brand_id AS brandId FROM stores WHERE id = ?', [storeId]);
    return row ? row.brandId : null;
  }

  // ─── Admin: Template CRUD ───────────────────────────────

  router.get('/admin/inspection/templates', adminAuth, async (req, res) => {
    try {
      const templates = await listTemplates(db, {
        brandId: req.query.brandId,
        activeOnly: req.query.all !== '1',
      });
      res.json({ templates });
    } catch (e) { respondError(res, e); }
  });

  router.post('/admin/inspection/templates', adminAuth, async (req, res) => {
    try {
      const template = await createTemplate(db, {
        brandId: req.body?.brandId,
        name: req.body?.name,
        description: req.body?.description,
        category: req.body?.category,
        totalScore: req.body?.totalScore,
      });
      res.status(201).json({ template });
    } catch (e) { respondError(res, e); }
  });

  router.get('/admin/inspection/templates/:id', adminAuth, async (req, res) => {
    try {
      const template = await getTemplate(db, req.params.id);
      res.json({ template });
    } catch (e) { respondError(res, e); }
  });

  router.patch('/admin/inspection/templates/:id', adminAuth, async (req, res) => {
    try {
      const template = await updateTemplate(db, req.params.id, req.body);
      res.json({ template });
    } catch (e) { respondError(res, e); }
  });

  router.delete('/admin/inspection/templates/:id', adminAuth, async (req, res) => {
    try {
      await deleteTemplate(db, req.params.id);
      res.status(204).send();
    } catch (e) { respondError(res, e); }
  });

  // ─── Admin: Check Items ─────────────────────────────────

  router.post('/admin/inspection/templates/:templateId/items', adminAuth, async (req, res) => {
    try {
      const item = await addCheckItem(db, {
        templateId: req.params.templateId,
        name: req.body?.name,
        description: req.body?.description,
        type: req.body?.type,
        maxScore: req.body?.maxScore,
        sortOrder: req.body?.sortOrder,
        isRequired: req.body?.isRequired,
      });
      res.status(201).json({ item });
    } catch (e) { respondError(res, e); }
  });

  router.patch('/admin/inspection/items/:id', adminAuth, async (req, res) => {
    try {
      const item = await updateCheckItem(db, req.params.id, req.body);
      res.json({ item });
    } catch (e) { respondError(res, e); }
  });

  router.delete('/admin/inspection/items/:id', adminAuth, async (req, res) => {
    try {
      await deleteCheckItem(db, req.params.id);
      res.status(204).send();
    } catch (e) { respondError(res, e); }
  });

  // ─── Admin: Inspections (view all) ──────────────────────

  router.get('/admin/inspection/list', adminAuth, async (req, res) => {
    try {
      const hasLimit = req.query.limit != null && req.query.limit !== '';
      const filters = {
        storeId: req.query.storeId,
        templateId: req.query.templateId,
        status: req.query.status,
        q: req.query.q,
      };
      if (hasLimit) {
        // Pagination envelope contract: { items, total, limit, offset }.
        const result = await listInspections(db, {
          ...filters,
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0,
          includeTotal: true,
        });
        return res.json(result);
      }
      const inspections = await listInspections(db, filters);
      res.json({ inspections });
    } catch (e) { respondError(res, e); }
  });

  // ─── Admin: Issues ──────────────────────────────────────

  router.get('/admin/inspection/issues', adminAuth, async (req, res) => {
    try {
      const hasLimit = req.query.limit != null && req.query.limit !== '';
      const filters = {
        storeId: req.query.storeId,
        status: req.query.status,
        severity: req.query.severity,
        q: req.query.q,
      };
      if (hasLimit) {
        // Pagination envelope contract: { items, total, limit, offset }.
        const result = await listIssues(db, {
          ...filters,
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0,
          includeTotal: true,
        });
        return res.json(result);
      }
      const issues = await listIssues(db, filters);
      res.json({ issues });
    } catch (e) { respondError(res, e); }
  });

  router.post('/admin/inspection/issues', adminAuth, async (req, res) => {
    try {
      const issue = await createIssue(db, {
        inspectionId: req.body?.inspectionId,
        storeId: req.body?.storeId,
        title: req.body?.title,
        description: req.body?.description,
        severity: req.body?.severity,
        assignedTo: req.body?.assignedTo,
        dueDate: req.body?.dueDate,
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin?.email,
        action: 'issue.create',
        targetType: 'issue',
        targetId: issue.id,
        detail: issue.title,
        ip: req.ip || null,
        brandId: await getStoreBrandId(issue.store_id),
      }).catch(() => {});
      res.status(201).json({ issue });
    } catch (e) { respondError(res, e); }
  });

  router.patch('/admin/inspection/issues/:id', adminAuth, async (req, res) => {
    try {
      const issue = await updateIssue(db, req.params.id, req.body);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin?.email,
        action: 'issue.update',
        targetType: 'issue',
        targetId: issue.id,
        detail: issue.title,
        ip: req.ip || null,
        brandId: await getStoreBrandId(issue.store_id),
      }).catch(() => {});
      res.json({ issue });
    } catch (e) { respondError(res, e); }
  });

  // static admin routes above; wildcard :id below
  router.get('/admin/inspection/:id', adminAuth, async (req, res) => {
    try {
      const inspection = await getInspection(db, req.params.id);
      res.json({ inspection });
    } catch (e) { respondError(res, e); }
  });

  // ─── Store: Execute Inspection ──────────────────────────

  router.get('/store/inspection/templates', storeAuth, async (req, res) => {
    try {
      const templates = await listTemplates(db, {
        brandId: req.storeAuth.brandId,
      });
      res.json({ templates });
    } catch (e) { respondError(res, e); }
  });

  router.get('/store/inspection/templates/:id', storeAuth, async (req, res) => {
    try {
      const template = await getTemplate(db, req.params.id);
      if (template.brand_id !== req.storeAuth.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json({ template });
    } catch (e) { respondError(res, e); }
  });

  router.post('/store/inspection/start', storeAuth, async (req, res) => {
    try {
      const inspection = await createInspection(db, {
        templateId: req.body?.templateId,
        storeId: req.storeAuth.storeId,
        inspectorId: req.body?.inspectorId || req.storeAuth.storeId,
        remarks: req.body?.remarks,
      });
      res.status(201).json({ inspection });
    } catch (e) { respondError(res, e); }
  });

  router.post('/store/inspection/:id/submit', storeAuth, async (req, res) => {
    try {
      const existing = await getInspection(db, req.params.id);
      if (existing.store_id !== req.storeAuth.storeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const inspection = await submitInspectionResults(db, {
        inspectionId: req.params.id,
        results: req.body?.results || [],
      });
      recordAudit(db, {
        actorType: 'store',
        actorId: req.body?.staffId != null ? String(req.body.staffId) : req.storeAuth.storeId,
        action: 'inspection.submit',
        targetType: 'inspection',
        targetId: req.params.id,
        detail: req.body?.staffId != null ? `staff=${req.body.staffId}` : null,
        ip: req.ip || null,
        brandId: req.storeAuth.brandId,
      }).catch(() => {});
      res.json({ inspection });
    } catch (e) { respondError(res, e); }
  });

  router.get('/store/inspection/history', storeAuth, async (req, res) => {
    try {
      const inspections = await listInspections(db, {
        storeId: req.storeAuth.storeId,
        limit: parseInt(req.query.limit) || 20,
      });
      res.json({ inspections });
    } catch (e) { respondError(res, e); }
  });


  // ─── Store: Self-Check ──────────────────────────────────

  router.post('/store/inspection/self-check/start', storeAuth, async (req, res) => {
    try {
      const result = await createSelfCheck(db, {
        storeId: req.storeAuth.storeId,
        templateId: req.body?.templateId,
        submittedBy: req.storeAuth.storeId,
      });
      res.status(201).json(result);
    } catch (e) { respondError(res, e); }
  });

  router.post('/store/inspection/self-check/:id/submit', storeAuth, async (req, res) => {
    try {
      const existing = await getInspection(db, req.params.id);
      if (existing.store_id !== req.storeAuth.storeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const result = await submitSelfCheckResults(db, {
        inspectionId: req.params.id,
        results: req.body?.results || [],
        photos: req.body?.photos || [],
      });
      recordAudit(db, {
        actorType: 'store',
        actorId: req.body?.staffId != null ? String(req.body.staffId) : req.storeAuth.storeId,
        action: 'inspection.self_check.submit',
        targetType: 'inspection',
        targetId: req.params.id,
        detail: req.body?.staffId != null ? `staff=${req.body.staffId}` : null,
        ip: req.ip || null,
        brandId: req.storeAuth.brandId,
      }).catch(() => {});
      res.json(result);
    } catch (e) { respondError(res, e); }
  });

  // ─── Scorecard & Grading ────────────────────────────────

  router.get('/admin/inspection/:id/scorecard', adminAuth, async (req, res) => {
    try {
      const scorecard = await getInspectionScorecard(db, req.params.id);
      res.json(scorecard);
    } catch (e) { respondError(res, e); }
  });

  router.get('/store/inspection/scores/history', storeAuth, async (req, res) => {
    try {
      const history = await getStoreScoreHistory(db, req.storeAuth.storeId, parseInt(req.query.limit) || 10);
      res.json({ history });
    } catch (e) { respondError(res, e); }
  });

  router.get('/store/inspection/:id/scorecard', storeAuth, async (req, res) => {
    try {
      const scorecard = await getInspectionScorecard(db, req.params.id);
      if (scorecard.store_id !== req.storeAuth.storeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json(scorecard);
    } catch (e) { respondError(res, e); }
  });

  return router;
}

module.exports = { buildInspectionRoutes };

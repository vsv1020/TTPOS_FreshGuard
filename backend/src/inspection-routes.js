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
} = require('./inspection-db');

function respondError(res, error) {
  const msg = String(error?.message || 'Request failed');
  if (msg.includes('not found')) return res.status(404).json({ error: msg });
  if (msg.includes('required')) return res.status(400).json({ error: msg });
  return res.status(400).json({ error: msg });
}

function buildInspectionRoutes({ db, adminAuth, storeAuth }) {
  const router = express.Router();

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
      const inspections = await listInspections(db, {
        storeId: req.query.storeId,
        templateId: req.query.templateId,
        status: req.query.status,
        limit: parseInt(req.query.limit) || 50,
      });
      res.json({ inspections });
    } catch (e) { respondError(res, e); }
  });

  router.get('/admin/inspection/:id', adminAuth, async (req, res) => {
    try {
      const inspection = await getInspection(db, req.params.id);
      res.json({ inspection });
    } catch (e) { respondError(res, e); }
  });

  // ─── Admin: Issues ──────────────────────────────────────

  router.get('/admin/inspection/issues', adminAuth, async (req, res) => {
    try {
      const issues = await listIssues(db, {
        storeId: req.query.storeId,
        status: req.query.status,
        severity: req.query.severity,
        limit: parseInt(req.query.limit) || 50,
      });
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
      res.status(201).json({ issue });
    } catch (e) { respondError(res, e); }
  });

  router.patch('/admin/inspection/issues/:id', adminAuth, async (req, res) => {
    try {
      const issue = await updateIssue(db, req.params.id, req.body);
      res.json({ issue });
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
      const inspection = await submitInspectionResults(db, {
        inspectionId: req.params.id,
        results: req.body?.results || [],
      });
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

  return router;
}

module.exports = { buildInspectionRoutes };

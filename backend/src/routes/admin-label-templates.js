const express = require('express');
const {
  createLabelTemplate,
  deleteLabelTemplate,
  getLabelTemplateById,
  listLabelTemplates,
  recordAudit,
  renderLabelFromTemplate,
  updateLabelTemplate
} = require('../db');
const { respondDataError, sendList } = require('../lib/http');

function buildAdminLabelTemplatesRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  // ─── Feature C: Label template CRUD ─────────────────────────────────────
  // Brand-scoped admins create/list/manage only within their own brand.
  function resolveTemplateBrandId(req) {
    return req.admin.brandId != null ? req.admin.brandId : req.body?.brandId;
  }

  router.get('/api/admin/label-templates', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : (req.query.brandId || undefined);
      const result = await listLabelTemplates(db, {
        brandId,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'templates', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/label-templates', adminApiAuth, async (req, res) => {
    try {
      const template = await createLabelTemplate(db, {
        brandId: resolveTemplateBrandId(req),
        name: req.body?.name,
        widthMm: req.body?.widthMm,
        heightMm: req.body?.heightMm,
        dpi: req.body?.dpi,
        bodyTemplate: req.body?.bodyTemplate,
        isDefault: req.body?.isDefault
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'label-template.create',
        targetType: 'label-template',
        targetId: template.id,
        detail: template.name,
        ip: req.ip,
        brandId: template.brandId
      });
      return res.status(201).json({ template });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.patch('/api/admin/label-templates/:id', adminApiAuth, async (req, res) => {
    try {
      const existing = await getLabelTemplateById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'templateId not found' });
      }
      if (req.admin.brandId != null && existing.brandId !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const template = await updateLabelTemplate(db, req.params.id, {
        name: req.body?.name,
        widthMm: req.body?.widthMm,
        heightMm: req.body?.heightMm,
        dpi: req.body?.dpi,
        bodyTemplate: req.body?.bodyTemplate,
        isDefault: req.body?.isDefault
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'label-template.update',
        targetType: 'label-template',
        targetId: template.id,
        detail: template.name,
        ip: req.ip,
        brandId: template.brandId
      });
      return res.json({ template });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.delete('/api/admin/label-templates/:id', adminApiAuth, async (req, res) => {
    try {
      const existing = await getLabelTemplateById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'templateId not found' });
      }
      if (req.admin.brandId != null && existing.brandId !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const template = await deleteLabelTemplate(db, req.params.id);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'label-template.delete',
        targetType: 'label-template',
        targetId: template.id,
        detail: template.name,
        ip: req.ip,
        brandId: template.brandId
      });
      return res.json({ template });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/label-templates/:id/preview', adminApiAuth, async (req, res) => {
    try {
      const existing = await getLabelTemplateById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'templateId not found' });
      }
      if (req.admin.brandId != null && existing.brandId !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : (req.body || {});
      const text = renderLabelFromTemplate(existing.bodyTemplate, fields);
      return res.json({ text });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminLabelTemplatesRoutes };

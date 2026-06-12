const express = require('express');
const {
  createBrand,
  getBrandPromoRules,
  getBrandReminderConfig,
  listBrands,
  recordAudit,
  updateBrandPromoRules,
  updateBrandReminderConfig
} = require('../db');
const { respondDataError } = require('../lib/http');

function buildAdminBrandsRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  router.get('/api/admin/brands', adminApiAuth, async (_req, res) => {
    const brands = await listBrands(db);
    return res.json({ brands });
  });

  router.post('/api/admin/brands', adminApiAuth, async (req, res) => {
    try {
      const brand = await createBrand(db, { name: req.body?.name });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'brand.create',
        targetType: 'brand',
        targetId: brand.id,
        detail: brand.name,
        ip: req.ip,
        brandId: brand.id
      });
      return res.status(201).json({ brand });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // Brand-level reminder config: expiring threshold (days) used as the default
  // for store reminder queries when no explicit thresholdDays is given.
  router.get('/api/admin/brands/:id/reminder-config', adminApiAuth, async (req, res) => {
    try {
      if (req.admin.brandId != null && Number(req.params.id) !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const reminderConfig = await getBrandReminderConfig(db, req.params.id);
      return res.json({ reminderConfig });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.put('/api/admin/brands/:id/reminder-config', adminApiAuth, async (req, res) => {
    try {
      if (req.admin.brandId != null && Number(req.params.id) !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const reminderConfig = await updateBrandReminderConfig(db, req.params.id, {
        thresholdDays: req.body?.thresholdDays
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'brand.reminder-config.update',
        targetType: 'brand',
        targetId: reminderConfig.brandId,
        detail: `thresholdDays=${reminderConfig.thresholdDays}`,
        ip: req.ip,
        brandId: reminderConfig.brandId
      });
      return res.json({ reminderConfig });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P2-3: brand-level near-expiry promo rules. Same brand-scope contract as
  // reminder-config; rules are applied to /api/store/reminders at query time.
  router.get('/api/admin/brands/:id/promo-rules', adminApiAuth, async (req, res) => {
    try {
      if (req.admin.brandId != null && Number(req.params.id) !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const promoRules = await getBrandPromoRules(db, req.params.id);
      return res.json(promoRules);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.put('/api/admin/brands/:id/promo-rules', adminApiAuth, async (req, res) => {
    try {
      if (req.admin.brandId != null && Number(req.params.id) !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const promoRules = await updateBrandPromoRules(db, req.params.id, {
        rules: req.body?.rules
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'brand.promo-rules.update',
        targetType: 'brand',
        targetId: promoRules.brandId,
        detail: JSON.stringify(promoRules.rules),
        ip: req.ip,
        brandId: promoRules.brandId
      });
      return res.json(promoRules);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminBrandsRoutes };

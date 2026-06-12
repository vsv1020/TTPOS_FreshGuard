const express = require('express');
const { requirePlatformAdmin } = require('../auth');
const {
  createAdminAccount,
  listAdminAccounts,
  listAdminUsers,
  recordAudit,
  resetAdminAccountPassword,
  updateAdminAccount
} = require('../db');
const { respondDataError, sendList } = require('../lib/http');

function buildAdminAccountsRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  router.get('/api/admin/me', adminApiAuth, (req, res) => {
    return res.json({
      id: Number(req.admin.sub),
      email: req.admin.email,
      role: req.admin.role,
      brandId: req.admin.brandId != null ? req.admin.brandId : null
    });
  });

  router.get('/api/admin/users', adminApiAuth, async (_req, res) => {
    const users = await listAdminUsers(db);
    return res.json({ users });
  });

  // ─── P1-1: RBAC admin account management (platform_admin only) ──────────

  router.get('/api/admin/admins', adminApiAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const result = await listAdminAccounts(db, {
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'admins', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/admins', adminApiAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const admin = await createAdminAccount(db, {
        email: req.body?.email,
        password: req.body?.password,
        role: req.body?.role,
        brandId: req.body?.brandId
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'admin.create',
        targetType: 'user',
        targetId: admin.id,
        detail: `${admin.email} role=${admin.role}`,
        ip: req.ip,
        brandId: admin.brandId
      });
      return res.status(201).json({ admin });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.put('/api/admin/admins/:id', adminApiAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const admin = await updateAdminAccount(db, req.params.id, {
        role: req.body?.role,
        brandId: req.body?.brandId,
        disabled: req.body?.disabled
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'admin.update',
        targetType: 'user',
        targetId: admin.id,
        detail: `${admin.email} role=${admin.role} disabled=${admin.disabled}`,
        ip: req.ip,
        brandId: admin.brandId
      });
      return res.json({ admin });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/admins/:id/reset-password', adminApiAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const admin = await resetAdminAccountPassword(db, req.params.id, req.body?.newPassword);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'admin.reset-password',
        targetType: 'user',
        targetId: admin.id,
        detail: admin.email,
        ip: req.ip,
        brandId: admin.brandId
      });
      return res.json({ ok: true });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminAccountsRoutes };

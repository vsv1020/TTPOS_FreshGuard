const express = require('express');
const {
  createBindingCode,
  createStore,
  createStoreStaff,
  deactivateStoreStaff,
  getStoreStaffById,
  incrementStoreTokenVersion,
  listBindingCodes,
  listStores,
  listStoreStaff,
  recordAudit,
  updateStoreStaff,
  updateStorePrinterSettings
} = require('../db');
const { respondDataError, sendList, makeAssertStoreInScope } = require('../lib/http');

function buildAdminStoresRoutes({ db, adminApiAuth }) {
  const router = express.Router();
  const assertStoreInScope = makeAssertStoreInScope(db);

  router.get('/api/admin/stores', adminApiAuth, async (req, res) => {
    const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
    const stores = await listStores(db, { brandId });
    return res.json({ stores });
  });

  router.post('/api/admin/stores', adminApiAuth, async (req, res) => {
    try {
      const store = await createStore(db, {
        brandId: req.body?.brandId,
        name: req.body?.name
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'store.create',
        targetType: 'store',
        targetId: store.id,
        detail: store.name,
        ip: req.ip,
        brandId: store.brandId
      });
      return res.status(201).json({ store });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.patch('/api/admin/stores/:storeId/printer-settings', adminApiAuth, async (req, res) => {
    try {
      const store = await updateStorePrinterSettings(db, req.params.storeId, {
        printerName: req.body?.printerName,
        printerModel: req.body?.printerModel,
        printerAddress: req.body?.printerAddress,
        printerPort: req.body?.printerPort,
        printerDpi: req.body?.printerDpi,
        labelWidthMm: req.body?.labelWidthMm
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'store.printer-settings.update',
        targetType: 'store',
        targetId: store.id,
        detail: store.name,
        ip: req.ip,
        brandId: store.brandId
      });
      return res.json({ store });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-7: bump the store token_version so all previously issued store JWTs
  // become invalid on the next request.
  router.post('/api/admin/stores/:storeId/revoke-tokens', adminApiAuth, async (req, res) => {
    try {
      const store = await assertStoreInScope(req, res, req.params.storeId);
      if (!store) return undefined;
      const updated = await incrementStoreTokenVersion(db, req.params.storeId);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'store.tokens.revoke',
        targetType: 'store',
        targetId: updated.id,
        detail: `tokenVersion=${updated.tokenVersion}`,
        ip: req.ip,
        brandId: updated.brandId
      });
      return res.json({ store: updated });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const result = await listBindingCodes(db, {
        brandId,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'bindingCodes', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
    try {
      const bindingCode = await createBindingCode(db, {
        storeId: req.body?.storeId,
        expiresInHours: req.body?.expiresInHours,
        code: req.body?.code
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'binding-code.create',
        targetType: 'binding-code',
        targetId: bindingCode.id,
        detail: `store=${bindingCode.storeId}`,
        ip: req.ip,
        brandId: bindingCode.brandId
      });
      return res.status(201).json({ bindingCode });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/admin/stores/:storeId/staff', adminApiAuth, async (req, res) => {
    try {
      const store = await assertStoreInScope(req, res, req.params.storeId);
      if (!store) return undefined;
      const result = await listStoreStaff(db, {
        storeId: req.params.storeId,
        includeInactive: true,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'staff', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/stores/:storeId/staff', adminApiAuth, async (req, res) => {
    try {
      const store = await assertStoreInScope(req, res, req.params.storeId);
      if (!store) return undefined;
      const staff = await createStoreStaff(db, {
        storeId: req.params.storeId,
        name: req.body?.name,
        pin: req.body?.pin,
        role: req.body?.role
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'staff.create',
        targetType: 'staff',
        targetId: staff.id,
        detail: staff.name,
        ip: req.ip,
        brandId: store.brandId
      });
      return res.status(201).json({ staff });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.patch('/api/admin/stores/:storeId/staff/:staffId', adminApiAuth, async (req, res) => {
    try {
      const store = await assertStoreInScope(req, res, req.params.storeId);
      if (!store) return undefined;
      const existing = await getStoreStaffById(db, req.params.staffId);
      if (!existing || existing.storeId !== store.id) {
        return res.status(404).json({ error: 'staffId not found' });
      }
      const staff = await updateStoreStaff(db, req.params.staffId, {
        name: req.body?.name,
        pin: req.body?.pin,
        role: req.body?.role,
        isActive: req.body?.isActive
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'staff.update',
        targetType: 'staff',
        targetId: staff.id,
        detail: staff.name,
        ip: req.ip,
        brandId: store.brandId
      });
      return res.json({ staff });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.delete('/api/admin/stores/:storeId/staff/:staffId', adminApiAuth, async (req, res) => {
    try {
      const store = await assertStoreInScope(req, res, req.params.storeId);
      if (!store) return undefined;
      const existing = await getStoreStaffById(db, req.params.staffId);
      if (!existing || existing.storeId !== store.id) {
        return res.status(404).json({ error: 'staffId not found' });
      }
      const staff = await deactivateStoreStaff(db, req.params.staffId);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'staff.deactivate',
        targetType: 'staff',
        targetId: staff.id,
        detail: staff.name,
        ip: req.ip,
        brandId: store.brandId
      });
      return res.json({ staff });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildAdminStoresRoutes };

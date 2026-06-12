const express = require('express');
const { signStoreToken } = require('../auth');
const {
  clearPinFailures,
  consumeBindingCode,
  createBatchWithReminders,
  getPinLockState,
  getStoreBatchByBarcode,
  handleReminder,
  listStoreProducts,
  listStoreReminders,
  listStoreStaff,
  openReminder,
  recordAudit,
  recordPinFailure,
  renderStoreBatchLabel,
  verifyStoreStaffPin
} = require('../db');
const { respondDataError, sendList } = require('../lib/http');

function buildStoreRoutes({ db, jwtSecret, storeApiAuth, bindLimiter }) {
  const router = express.Router();

  router.post('/api/store/bind', bindLimiter, async (req, res) => {
    try {
      const { bindingCode, store } = await consumeBindingCode(db, {
        code: req.body?.code,
        deviceId: req.body?.deviceId
      });

      const token = signStoreToken(store, jwtSecret);
      return res.json({
        token,
        store,
        bindingCode
      });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/store/me', storeApiAuth, async (req, res) => {
    return res.json({
      storeId: req.storeAuth.storeId,
      brandId: req.storeAuth.brandId,
      storeName: req.storeAuth.storeName,
      brandName: req.storeAuth.brandName
    });
  });

  router.get('/api/store/products', storeApiAuth, async (req, res) => {
    try {
      const result = await listStoreProducts(db, req.storeAuth.storeId, {
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'products', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/store/staff', storeApiAuth, async (req, res) => {
    try {
      const staff = await listStoreStaff(db, { storeId: req.storeAuth.storeId });
      return res.json({ staff });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-7: SQLite-persisted throttle — 5 consecutive failures for the same
  // store+staff lock verification for 15 minutes (survives restarts).
  router.post('/api/store/staff/:staffId/verify-pin', storeApiAuth, async (req, res) => {
    try {
      const storeId = req.storeAuth.storeId;
      const staffId = req.params.staffId;

      const lock = await getPinLockState(db, { storeId, staffId });
      if (lock.locked) {
        return res.status(429).json({
          message: 'Too many failed PIN attempts. Try again later.',
          retryAfterSeconds: lock.retryAfterSeconds
        });
      }

      const valid = await verifyStoreStaffPin(db, {
        storeId,
        staffId,
        pin: req.body?.pin
      });
      if (valid) {
        await clearPinFailures(db, { storeId, staffId });
      } else {
        await recordPinFailure(db, { storeId, staffId });
      }
      return res.json({ valid });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/store/print', storeApiAuth, async (req, res) => {
    try {
      const result = await createBatchWithReminders(db, {
        storeId: req.storeAuth.storeId,
        productId: req.body?.productId,
        quantity: req.body?.quantity,
        printedAt: req.body?.printedAt,
        staffId: req.body?.staffId
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.body?.staffId != null ? String(req.body.staffId) : req.storeAuth.storeId,
        action: 'print',
        targetType: 'batch',
        targetId: result.batch.id,
        detail: `qty=${result.batch.quantity}${req.body?.staffId != null ? ` staff=${req.body.staffId}` : ''}`,
        ip: req.ip,
        brandId: req.storeAuth.brandId
      });

      return res.status(201).json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-4: resolve a scanned label barcode to its batch (own store only; a
  // barcode from another store is indistinguishable from an unknown one).
  router.get('/api/store/batches/by-barcode', storeApiAuth, async (req, res) => {
    try {
      const result = await getStoreBatchByBarcode(db, {
        storeId: req.storeAuth.storeId,
        code: req.query.code
      });
      if (!result) {
        return res.status(404).json({ message: 'No batch found for this barcode in your store' });
      }
      return res.json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-5: re-render a historical batch label for reprinting. The `label`
  // shape matches the POST /api/store/print response.
  router.get('/api/store/batches/:batchId/label', storeApiAuth, async (req, res) => {
    try {
      const result = await renderStoreBatchLabel(db, {
        storeId: req.storeAuth.storeId,
        batchId: req.params.batchId
      });
      return res.json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.get('/api/store/reminders', storeApiAuth, async (req, res) => {
    try {
      const result = await listStoreReminders(db, {
        storeId: req.storeAuth.storeId,
        status: req.query.status,
        thresholdDays: req.query.thresholdDays,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });

      return sendList(res, 'reminders', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/store/reminders/:reminderId/handle', storeApiAuth, async (req, res) => {
    try {
      const reminder = await handleReminder(db, {
        storeId: req.storeAuth.storeId,
        reminderId: req.params.reminderId,
        reason: req.body?.reason,
        note: req.body?.note,
        staffId: req.body?.staffId
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.body?.staffId != null ? String(req.body.staffId) : req.storeAuth.storeId,
        action: 'reminder.handle',
        targetType: 'reminder',
        targetId: reminder.id,
        detail: `${String(req.body?.reason || '')}${req.body?.staffId != null ? ` staff=${req.body.staffId}` : ''}`,
        ip: req.ip,
        brandId: req.storeAuth.brandId
      });

      return res.json({ reminder });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/store/reminders/:reminderId/open', storeApiAuth, async (req, res) => {
    try {
      const result = await openReminder(db, {
        storeId: req.storeAuth.storeId,
        reminderId: req.params.reminderId,
        staffId: req.body?.staffId
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.body?.staffId != null ? String(req.body.staffId) : req.storeAuth.storeId,
        action: 'reminder.open',
        targetType: 'reminder',
        targetId: result.reminder.id,
        detail: req.body?.staffId != null ? `staff=${req.body.staffId}` : null,
        ip: req.ip,
        brandId: req.storeAuth.brandId
      });

      return res.status(201).json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  return router;
}

module.exports = { buildStoreRoutes };

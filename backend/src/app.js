const path = require('path');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  COOKIE_NAME,
  requireAdminApi,
  requireAdminWeb,
  requireStoreApi,
  signAdminToken,
  signStoreToken
} = require('./auth');
const { initInspectionSchema, listInspections } = require('./inspection-db');
const { buildInspectionRoutes } = require('./inspection-routes');
const {
  consumeBindingCode,
  createBatchWithReminders,
  createBindingCode,
  createBrand,
  createProduct,
  createStore,
  deleteProduct,
  getProductById,
  getUserByEmail,
  handleReminder,
  listAdminUsers,
  listAuditLogs,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listProducts,
  listStoreProducts,
  listStoreReminders,
  listStores,
  openReminder,
  recordAudit,
  updateProduct,
  updateStorePrinterSettings
} = require('./db');

function respondDataError(res, error) {
  const message = String(error?.message || 'Request failed');

  if (message.includes('not found') || message.includes('Reminder not found')) {
    return res.status(404).json({ error: message });
  }

  if (message.includes('already used') || message.includes('already handled')) {
    return res.status(409).json({ error: message });
  }

  if (message.includes('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'Constraint violation' });
  }

  if (message.includes('Invalid binding code') || message.includes('expired')) {
    return res.status(400).json({ error: message });
  }

  return res.status(400).json({ error: message });
}

function csvEscape(value) {
  if (value == null) {
    return '';
  }
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvEscape(row[c.key])).join(','))
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(rowsToCsv(columns, rows));
}

function buildApp({ db, jwtSecret, adminWebDir }) {
  const app = express();
  const webRoot = adminWebDir || path.join(__dirname, '..', 'admin-web');
  const adminApiAuth = requireAdminApi({ jwtSecret });
  const adminWebAuth = requireAdminWeb({ jwtSecret });
  const storeApiAuth = requireStoreApi({ jwtSecret });

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : null;
  const corsOriginOption = corsOrigins
    ? corsOrigins
    : (process.env.NODE_ENV !== 'production' ? true : []);
  app.use(cors({ origin: corsOriginOption, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  const isTest = process.env.NODE_ENV === 'test';

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest
  });

  const bindLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest
  });

  // Inspection module
  initInspectionSchema(db).catch(e => console.error("Inspection schema init failed:", e));
  const inspectionRouter = buildInspectionRoutes({ db, adminAuth: adminApiAuth, storeAuth: storeApiAuth });
  app.use("/api", inspectionRouter);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await getUserByEmail(db, email);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAdminToken(user, jwtSecret);

    recordAudit(db, {
      actorType: 'admin',
      actorId: user.email,
      action: 'login',
      targetType: 'user',
      targetId: user.id,
      ip: req.ip
    });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME);
    return res.status(204).send();
  });

  app.get('/api/admin/me', adminApiAuth, (req, res) => {
    return res.json({
      id: Number(req.admin.sub),
      email: req.admin.email,
      role: req.admin.role
    });
  });

  app.get('/api/admin/users', adminApiAuth, async (_req, res) => {
    const users = await listAdminUsers(db);
    return res.json({ users });
  });

  app.get('/api/admin/brands', adminApiAuth, async (_req, res) => {
    const brands = await listBrands(db);
    return res.json({ brands });
  });

  app.post('/api/admin/brands', adminApiAuth, async (req, res) => {
    try {
      const brand = await createBrand(db, { name: req.body?.name });
      return res.status(201).json({ brand });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/stores', adminApiAuth, async (req, res) => {
    const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
    const stores = await listStores(db, { brandId });
    return res.json({ stores });
  });

  app.post('/api/admin/stores', adminApiAuth, async (req, res) => {
    try {
      const store = await createStore(db, {
        brandId: req.body?.brandId,
        name: req.body?.name
      });
      return res.status(201).json({ store });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.patch('/api/admin/stores/:storeId/printer-settings', adminApiAuth, async (req, res) => {
    try {
      const store = await updateStorePrinterSettings(db, req.params.storeId, {
        printerName: req.body?.printerName,
        printerModel: req.body?.printerModel,
        printerAddress: req.body?.printerAddress,
        printerPort: req.body?.printerPort,
        printerDpi: req.body?.printerDpi,
        labelWidthMm: req.body?.labelWidthMm
      });
      return res.json({ store });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
    const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
    const bindingCodes = await listBindingCodes(db, { brandId });
    return res.json({ bindingCodes });
  });

  app.post('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
    try {
      const bindingCode = await createBindingCode(db, {
        storeId: req.body?.storeId,
        expiresInHours: req.body?.expiresInHours,
        code: req.body?.code
      });
      return res.status(201).json({ bindingCode });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/products', adminApiAuth, async (req, res) => {
    try {
      const effectiveBrandId = req.admin.brandId != null ? req.admin.brandId : req.query.brandId;
      const products = await listProducts(db, { brandId: effectiveBrandId });
      return res.json({ products });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/admin/products', adminApiAuth, async (req, res) => {
    try {
      const product = await createProduct(db, {
        brandId: req.body?.brandId,
        name: req.body?.name,
        sku: req.body?.sku,
        shelfLifeDays: req.body?.shelfLifeDays,
        labelLanguage: req.body?.labelLanguage,
        primaryLanguage: req.body?.primaryLanguage,
        secondaryLanguage: req.body?.secondaryLanguage,
        allergens: req.body?.allergens,
        storageConditions: req.body?.storageConditions,
        openedShelfLifeHours: req.body?.openedShelfLifeHours
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'product.create',
        targetType: 'product',
        targetId: product.id,
        detail: product.name,
        ip: req.ip
      });
      return res.status(201).json({ product });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.patch('/api/admin/products/:id', adminApiAuth, async (req, res) => {
    try {
      const existing = await getProductById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'productId not found' });
      }
      if (req.admin.brandId != null && existing.brandId !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const product = await updateProduct(db, req.params.id, {
        name: req.body?.name,
        sku: req.body?.sku,
        shelfLifeDays: req.body?.shelfLifeDays,
        labelLanguage: req.body?.labelLanguage,
        primaryLanguage: req.body?.primaryLanguage,
        secondaryLanguage: req.body?.secondaryLanguage,
        allergens: req.body?.allergens,
        storageConditions: req.body?.storageConditions,
        openedShelfLifeHours: req.body?.openedShelfLifeHours
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'product.update',
        targetType: 'product',
        targetId: product.id,
        detail: product.name,
        ip: req.ip
      });
      return res.json({ product });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.delete('/api/admin/products/:id', adminApiAuth, async (req, res) => {
    try {
      const existing = await getProductById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'productId not found' });
      }
      if (req.admin.brandId != null && existing.brandId !== req.admin.brandId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const product = await deleteProduct(db, req.params.id);
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'product.delete',
        targetType: 'product',
        targetId: product.id,
        detail: product.name,
        ip: req.ip
      });
      return res.json({ product });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/reports/expired-handling', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const rows = await listExpiredHandlingReport(db, {
        brandId,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });

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

      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/reports/inspections', adminApiAuth, async (req, res) => {
    try {
      const rows = await listInspections(db, {
        storeId: req.query.storeId,
        templateId: req.query.templateId,
        status: req.query.status,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });

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

      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/audit-logs', adminApiAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = await listAuditLogs(db, { limit });
      return res.json({ logs });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/store/bind', bindLimiter, async (req, res) => {
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

  app.get('/api/store/me', storeApiAuth, async (req, res) => {
    return res.json({
      storeId: req.storeAuth.storeId,
      brandId: req.storeAuth.brandId,
      storeName: req.storeAuth.storeName,
      brandName: req.storeAuth.brandName
    });
  });

  app.get('/api/store/products', storeApiAuth, async (req, res) => {
    try {
      const products = await listStoreProducts(db, req.storeAuth.storeId);
      return res.json({ products });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/store/print', storeApiAuth, async (req, res) => {
    try {
      const result = await createBatchWithReminders(db, {
        storeId: req.storeAuth.storeId,
        productId: req.body?.productId,
        quantity: req.body?.quantity,
        printedAt: req.body?.printedAt
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.storeAuth.storeId,
        action: 'print',
        targetType: 'batch',
        targetId: result.batch.id,
        detail: `qty=${result.batch.quantity}`,
        ip: req.ip
      });

      return res.status(201).json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/store/reminders', storeApiAuth, async (req, res) => {
    try {
      const reminders = await listStoreReminders(db, {
        storeId: req.storeAuth.storeId,
        status: req.query.status,
        thresholdDays: req.query.thresholdDays
      });

      return res.json({ reminders });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/store/reminders/:reminderId/handle', storeApiAuth, async (req, res) => {
    try {
      const reminder = await handleReminder(db, {
        storeId: req.storeAuth.storeId,
        reminderId: req.params.reminderId,
        reason: req.body?.reason,
        note: req.body?.note
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.storeAuth.storeId,
        action: 'reminder.handle',
        targetType: 'reminder',
        targetId: reminder.id,
        detail: String(req.body?.reason || ''),
        ip: req.ip
      });

      return res.json({ reminder });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/store/reminders/:reminderId/open', storeApiAuth, async (req, res) => {
    try {
      const result = await openReminder(db, {
        storeId: req.storeAuth.storeId,
        reminderId: req.params.reminderId
      });

      recordAudit(db, {
        actorType: 'store',
        actorId: req.storeAuth.storeId,
        action: 'reminder.open',
        targetType: 'reminder',
        targetId: result.reminder.id,
        ip: req.ip
      });

      return res.status(201).json(result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.use('/admin/assets', express.static(path.join(webRoot, 'assets')));

  // Vue3 Frontend (built to backend/public/)
  const vue3Dir = path.join(__dirname, '..', 'public');
  app.use('/app', express.static(vue3Dir));
  // SPA fallback for Vue3 hash router
  app.get('/app/*', (req, res) => {
    res.sendFile(path.join(vue3Dir, 'index.html'));
  });

  app.get('/admin/login', (_req, res) => {
    res.sendFile(path.join(webRoot, 'login.html'));
  });

  app.get('/admin', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'dashboard.html'));
  });

  app.get('/admin/dashboard', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'dashboard.html'));
  });

  app.get('/admin/binding', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'binding.html'));
  });

  app.get('/admin/products', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'products.html'));
  });

  app.get('/admin/report', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'report.html'));
  });

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  return app;
}

module.exports = { buildApp };

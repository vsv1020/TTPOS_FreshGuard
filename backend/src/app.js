const path = require('path');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const {
  COOKIE_NAME,
  requireAdminApi,
  requireAdminWeb,
  requireStoreApi,
  signAdminToken,
  signStoreToken
} = require('./auth');
const {
  consumeBindingCode,
  createBatchWithReminders,
  createBindingCode,
  createBrand,
  createProduct,
  createStore,
  getUserByEmail,
  handleReminder,
  listAdminUsers,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listProducts,
  listStoreProducts,
  listStoreReminders,
  listStores,
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

function buildApp({ db, jwtSecret, adminWebDir }) {
  const app = express();
  const webRoot = adminWebDir || path.join(__dirname, '..', 'admin-web');
  const adminApiAuth = requireAdminApi({ jwtSecret });
  const adminWebAuth = requireAdminWeb({ jwtSecret });
  const storeApiAuth = requireStoreApi({ jwtSecret });

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/login', async (req, res) => {
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

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
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

  app.get('/api/admin/stores', adminApiAuth, async (_req, res) => {
    const stores = await listStores(db);
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

  app.get('/api/admin/binding-codes', adminApiAuth, async (_req, res) => {
    const bindingCodes = await listBindingCodes(db);
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
      const products = await listProducts(db, { brandId: req.query.brandId });
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
        secondaryLanguage: req.body?.secondaryLanguage
      });
      return res.status(201).json({ product });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/reports/expired-handling', adminApiAuth, async (_req, res) => {
    const rows = await listExpiredHandlingReport(db);
    return res.json({ rows });
  });

  app.post('/api/store/bind', async (req, res) => {
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

      return res.json({ reminder });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.use('/admin/assets', express.static(path.join(webRoot, 'assets')));

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

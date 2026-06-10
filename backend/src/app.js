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
  createLabelTemplate,
  createProduct,
  createStore,
  createStoreStaff,
  deactivateStoreStaff,
  deleteLabelTemplate,
  deleteProduct,
  getBrandReminderConfig,
  getDashboardSummary,
  getInspectionScoreTrend,
  getLabelTemplateById,
  getLossTrend,
  getProductById,
  getStoreById,
  getStoreExpiryRanking,
  getStoreStaffById,
  getUserByEmail,
  handleReminder,
  listAdminUsers,
  listAuditLogs,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listLabelTemplates,
  listProducts,
  listStoreProducts,
  listStoreReminders,
  listStores,
  listStoreStaff,
  openReminder,
  recordAudit,
  renderLabelFromTemplate,
  updateBrandReminderConfig,
  updateLabelTemplate,
  updateProduct,
  updateStoreStaff,
  updateStorePrinterSettings,
  verifyStoreStaffPin
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

// Pagination contract: list db functions return a plain array when no `limit`
// query param is given (legacy shape) and an { items, total, limit, offset }
// envelope when `limit` is present. `key` names the legacy wrapper property.
function sendList(res, key, result) {
  if (Array.isArray(result)) {
    return res.json({ [key]: result });
  }
  return res.json(result);
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
      ip: req.ip,
      brandId: user.brand_id
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
  app.get('/api/admin/brands/:id/reminder-config', adminApiAuth, async (req, res) => {
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

  app.put('/api/admin/brands/:id/reminder-config', adminApiAuth, async (req, res) => {
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

  app.get('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
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

  app.post('/api/admin/binding-codes', adminApiAuth, async (req, res) => {
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

  app.get('/api/admin/products', adminApiAuth, async (req, res) => {
    try {
      const effectiveBrandId = req.admin.brandId != null ? req.admin.brandId : req.query.brandId;
      const result = await listProducts(db, {
        brandId: effectiveBrandId,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'products', result);
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
        ip: req.ip,
        brandId: product.brandId
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
        ip: req.ip,
        brandId: product.brandId
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
        ip: req.ip,
        brandId: product.brandId
      });
      return res.json({ product });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/reports/expired-handling', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const result = await listExpiredHandlingReport(db, {
        brandId,
        startDate: req.query.startDate != null ? req.query.startDate : req.query.from,
        endDate: req.query.endDate != null ? req.query.endDate : req.query.to,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      const rows = Array.isArray(result) ? result : result.items;

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

      if (!Array.isArray(result)) {
        return res.json(result);
      }
      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/reports/inspections', adminApiAuth, async (req, res) => {
    try {
      const hasLimit = req.query.limit != null && req.query.limit !== '' && req.query.format !== 'csv';
      const result = await listInspections(db, {
        storeId: req.query.storeId,
        templateId: req.query.templateId,
        status: req.query.status,
        q: req.query.q,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : 0,
        includeTotal: hasLimit
      });
      const rows = Array.isArray(result) ? result : result.items;

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

      if (!Array.isArray(result)) {
        return res.json(result);
      }
      return res.json({ rows });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/audit-logs', adminApiAuth, async (req, res) => {
    try {
      // Brand-scoped admins only read their own brand's trail; platform admins see all.
      const result = await listAuditLogs(db, {
        brandId: req.admin.brandId != null ? req.admin.brandId : undefined,
        actor: req.query.actor,
        action: req.query.action,
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });
      return sendList(res, 'logs', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // ─── Feature A: Store staff management (admin) ──────────────────────────
  // When the admin is brand-scoped, the target store must belong to that brand.
  async function assertStoreInScope(req, res, storeId) {
    const store = await getStoreById(db, storeId);
    if (!store) {
      res.status(404).json({ error: 'storeId not found' });
      return null;
    }
    if (req.admin.brandId != null && store.brandId !== req.admin.brandId) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return store;
  }

  app.get('/api/admin/stores/:storeId/staff', adminApiAuth, async (req, res) => {
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

  app.post('/api/admin/stores/:storeId/staff', adminApiAuth, async (req, res) => {
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

  app.patch('/api/admin/stores/:storeId/staff/:staffId', adminApiAuth, async (req, res) => {
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

  app.delete('/api/admin/stores/:storeId/staff/:staffId', adminApiAuth, async (req, res) => {
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

  // ─── Feature B: Dashboard aggregation ───────────────────────────────────

  app.get('/api/admin/dashboard/summary', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const summary = await getDashboardSummary(db, { brandId });
      return res.json({ summary });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/dashboard/ranking', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const ranking = await getStoreExpiryRanking(db, {
        brandId,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });
      return res.json({ ranking });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/dashboard/loss-trend', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const trend = await getLossTrend(db, {
        brandId,
        days: req.query.days ? Number(req.query.days) : undefined
      });
      return res.json({ trend });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.get('/api/admin/dashboard/score-trend', adminApiAuth, async (req, res) => {
    try {
      const brandId = req.admin.brandId != null ? req.admin.brandId : undefined;
      const trend = await getInspectionScoreTrend(db, {
        brandId,
        days: req.query.days ? Number(req.query.days) : undefined
      });
      return res.json({ trend });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // ─── Feature C: Label template CRUD ─────────────────────────────────────
  // Brand-scoped admins create/list/manage only within their own brand.
  function resolveTemplateBrandId(req) {
    return req.admin.brandId != null ? req.admin.brandId : req.body?.brandId;
  }

  app.get('/api/admin/label-templates', adminApiAuth, async (req, res) => {
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

  app.post('/api/admin/label-templates', adminApiAuth, async (req, res) => {
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

  app.patch('/api/admin/label-templates/:id', adminApiAuth, async (req, res) => {
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

  app.delete('/api/admin/label-templates/:id', adminApiAuth, async (req, res) => {
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

  app.post('/api/admin/label-templates/:id/preview', adminApiAuth, async (req, res) => {
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

  app.get('/api/store/staff', storeApiAuth, async (req, res) => {
    try {
      const staff = await listStoreStaff(db, { storeId: req.storeAuth.storeId });
      return res.json({ staff });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  app.post('/api/store/staff/:staffId/verify-pin', storeApiAuth, async (req, res) => {
    try {
      const valid = await verifyStoreStaffPin(db, {
        storeId: req.storeAuth.storeId,
        staffId: req.params.staffId,
        pin: req.body?.pin
      });
      return res.json({ valid });
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

  app.get('/api/store/reminders', storeApiAuth, async (req, res) => {
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

  app.post('/api/store/reminders/:reminderId/handle', storeApiAuth, async (req, res) => {
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

  app.post('/api/store/reminders/:reminderId/open', storeApiAuth, async (req, res) => {
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

  app.get('/admin/staff', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'staff.html'));
  });

  app.get('/admin/label-templates', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'label-templates.html'));
  });

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  return app;
}

module.exports = { buildApp };

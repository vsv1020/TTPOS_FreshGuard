const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  blockViewerWrites,
  requireAdminApi,
  requireAdminWeb,
  requireStoreApi
} = require('./auth');
const { initInspectionSchema } = require('./inspection-db');
const { buildInspectionRoutes } = require('./inspection-routes');
const { buildAuthRoutes } = require('./routes/auth');
const { buildAdminAccountsRoutes } = require('./routes/admin-accounts');
const { buildAdminBrandsRoutes } = require('./routes/admin-brands');
const { buildAdminStoresRoutes } = require('./routes/admin-stores');
const { buildAdminProductsRoutes } = require('./routes/admin-products');
const { buildAdminReportsRoutes } = require('./routes/admin-reports');
const { buildAdminDashboardRoutes } = require('./routes/admin-dashboard');
const { buildAdminLabelTemplatesRoutes } = require('./routes/admin-label-templates');
const { buildStoreRoutes } = require('./routes/store');
const { buildAdminPagesRoutes } = require('./routes/admin-pages');

function buildApp({ db, jwtSecret, adminWebDir }) {
  const app = express();
  const webRoot = adminWebDir || path.join(__dirname, '..', 'admin-web');
  // Viewer accounts are read-only across every /api/admin route (including the
  // inspection router, which receives this same middleware chain).
  const adminApiAuth = [requireAdminApi({ jwtSecret }), blockViewerWrites];
  const adminWebAuth = requireAdminWeb({ jwtSecret });
  const storeApiAuth = requireStoreApi({ jwtSecret, db });

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

  // JSON message so both admin-web (body.error) and the Flutter app
  // (parsed['error']) can render the 429 instead of choking on plain text.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many login attempts. Try again later.' }
  });

  const bindLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many binding attempts. Try again later.' }
  });

  // Inspection module
  initInspectionSchema(db).catch(e => console.error("Inspection schema init failed:", e));
  const inspectionRouter = buildInspectionRoutes({ db, adminAuth: adminApiAuth, storeAuth: storeApiAuth });
  app.use("/api", inspectionRouter);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(buildAuthRoutes({ db, jwtSecret, loginLimiter }));
  app.use(buildAdminAccountsRoutes({ db, adminApiAuth }));
  app.use(buildAdminBrandsRoutes({ db, adminApiAuth }));
  app.use(buildAdminStoresRoutes({ db, adminApiAuth }));
  app.use(buildAdminProductsRoutes({ db, adminApiAuth }));
  app.use(buildAdminReportsRoutes({ db, adminApiAuth }));
  app.use(buildAdminDashboardRoutes({ db, adminApiAuth }));
  app.use(buildAdminLabelTemplatesRoutes({ db, adminApiAuth }));
  app.use(buildStoreRoutes({ db, jwtSecret, storeApiAuth, bindLimiter }));
  app.use(buildAdminPagesRoutes({ webRoot, adminWebAuth }));

  return app;
}

module.exports = { buildApp };

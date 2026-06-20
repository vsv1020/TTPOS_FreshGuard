const path = require('path');
const express = require('express');

function buildAdminPagesRoutes({ webRoot, adminWebAuth }) {
  const router = express.Router();

  router.use('/admin/assets', express.static(path.join(webRoot, 'assets')));

  // Vue3 Frontend (built to backend/public/)
  const vue3Dir = path.join(__dirname, '..', '..', 'public');
  router.use('/app', express.static(vue3Dir));
  // SPA fallback for Vue3 hash router
  router.get('/app/*', (req, res) => {
    res.sendFile(path.join(vue3Dir, 'index.html'));
  });

  router.get('/admin/login', (_req, res) => {
    res.sendFile(path.join(webRoot, 'login.html'));
  });

  router.get('/admin', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'dashboard.html'));
  });

  router.get('/admin/dashboard', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'dashboard.html'));
  });

  router.get('/admin/binding', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'binding.html'));
  });

  router.get('/admin/products', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'products.html'));
  });

  router.get('/admin/report', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'report.html'));
  });

  router.get('/admin/staff', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'staff.html'));
  });

  router.get('/admin/label-templates', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'label-templates.html'));
  });

  router.get('/admin/audit-logs', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'audit-logs.html'));
  });

  router.get('/admin/admins', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'admins.html'));
  });

  router.get('/admin/waste', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'waste.html'));
  });

  router.get('/admin/compliance', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'compliance.html'));
  });

  router.get('/admin/erp-sync', adminWebAuth, (_req, res) => {
    res.sendFile(path.join(webRoot, 'erp-sync.html'));
  });

  router.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  return router;
}

module.exports = { buildAdminPagesRoutes };

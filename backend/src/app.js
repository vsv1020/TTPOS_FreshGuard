const path = require('path');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const { COOKIE_NAME, requireAdminApi, requireAdminWeb, signAdminToken } = require('./auth');
const { getUserByEmail, listAdminUsers } = require('./db');

function buildApp({ db, jwtSecret, adminWebDir }) {
  const app = express();
  const webRoot = adminWebDir || path.join(__dirname, '..', 'admin-web');
  const adminApiAuth = requireAdminApi({ jwtSecret });
  const adminWebAuth = requireAdminWeb({ jwtSecret });

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

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  return app;
}

module.exports = { buildApp };

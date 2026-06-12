const bcrypt = require('bcryptjs');
const express = require('express');
const { ADMIN_ROLES, COOKIE_NAME, signAdminToken } = require('../auth');
const { getUserByEmail, recordAudit } = require('../db');

function buildAuthRoutes({ db, jwtSecret, loginLimiter }) {
  const router = express.Router();

  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await getUserByEmail(db, email);
    if (!user || !ADMIN_ROLES.includes(user.role) || user.disabled) {
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
        role: user.role,
        brandId: user.brand_id != null ? user.brand_id : null
      }
    });
  });

  router.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME);
    return res.status(204).send();
  });

  return router;
}

module.exports = { buildAuthRoutes };

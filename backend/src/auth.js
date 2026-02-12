const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'admin_token';

function signAdminToken(user, jwtSecret, expiresIn = '12h') {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role
    },
    jwtSecret,
    { expiresIn }
  );
}

function verifyAdminToken(token, jwtSecret) {
  return jwt.verify(token, jwtSecret);
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  return null;
}

function requireAdminApi({ jwtSecret }) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const decoded = verifyAdminToken(token, jwtSecret);
      if (decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.admin = decoded;
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

function requireAdminWeb({ jwtSecret }) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.redirect('/admin/login');
    }

    try {
      const decoded = verifyAdminToken(token, jwtSecret);
      if (decoded.role !== 'admin') {
        return res.redirect('/admin/login');
      }
      req.admin = decoded;
      return next();
    } catch (_error) {
      return res.redirect('/admin/login');
    }
  };
}

module.exports = {
  COOKIE_NAME,
  requireAdminApi,
  requireAdminWeb,
  signAdminToken
};

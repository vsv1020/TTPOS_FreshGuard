const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'admin_token';

// Admin console roles. Legacy tokens/rows use 'admin'; they are normalized to
// platform_admin (no brand) or brand_admin (brand-scoped) at verification time.
const ADMIN_ROLES = ['admin', 'platform_admin', 'brand_admin', 'viewer'];

function normalizeAdminRole(decoded) {
  if (decoded.role === 'admin') {
    return decoded.brandId != null ? 'brand_admin' : 'platform_admin';
  }
  return decoded.role;
}

function signAdminToken(user, jwtSecret, expiresIn = '12h') {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      tokenType: 'admin',
      brandId: user.brand_id != null ? user.brand_id : null
    },
    jwtSecret,
    { expiresIn }
  );
}

function signStoreToken(store, jwtSecret, expiresIn = '45d') {
  return jwt.sign(
    {
      sub: `store:${store.id}`,
      role: 'store',
      tokenType: 'store',
      storeId: store.id,
      brandId: store.brandId,
      storeName: store.name,
      brandName: store.brandName,
      tokenVersion: store.tokenVersion != null ? store.tokenVersion : 0
    },
    jwtSecret,
    { expiresIn }
  );
}

function verifyToken(token, jwtSecret) {
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
      const decoded = verifyToken(token, jwtSecret);
      if (!ADMIN_ROLES.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.admin = { ...decoded, role: normalizeAdminRole(decoded) };
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

// Viewer accounts are read-only: any non-read /api/admin call is forbidden.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function blockViewerWrites(req, res, next) {
  if (req.admin && req.admin.role === 'viewer' && !READ_METHODS.has(req.method)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

// Admin-account management is platform_admin only. Must run after requireAdminApi.
function requirePlatformAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

function requireStoreApi({ jwtSecret, db }) {
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const decoded = verifyToken(token, jwtSecret);
      if (decoded.role !== 'store' || !decoded.storeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      // Token revocation: stores carry a token_version; a token minted before
      // the last revoke (or for a deleted store) is rejected. Legacy tokens
      // without tokenVersion count as version 0, matching the column default.
      if (db) {
        const row = await db.get(
          'SELECT token_version AS tokenVersion FROM stores WHERE id = ?',
          decoded.storeId
        );
        if (!row) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const tokenVersion = decoded.tokenVersion != null ? Number(decoded.tokenVersion) : 0;
        if (Number(row.tokenVersion || 0) !== tokenVersion) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
      req.storeAuth = decoded;
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
      const decoded = verifyToken(token, jwtSecret);
      if (!ADMIN_ROLES.includes(decoded.role)) {
        return res.redirect('/admin/login');
      }
      req.admin = { ...decoded, role: normalizeAdminRole(decoded) };
      return next();
    } catch (_error) {
      return res.redirect('/admin/login');
    }
  };
}

module.exports = {
  ADMIN_ROLES,
  COOKIE_NAME,
  blockViewerWrites,
  requireAdminApi,
  requireAdminWeb,
  requirePlatformAdmin,
  requireStoreApi,
  signAdminToken,
  signStoreToken
};

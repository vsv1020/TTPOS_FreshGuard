const { requirePositiveInteger, likeParam, normalizePagination, nowIso } = require('../lib/util');

function recordAudit(db, { actorType, actorId, action, targetType, targetId, detail, ip, brandId }) {
  // Audit logging must never break the main flow; swallow any error.
  return db
    .run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, detail, ip, brand_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      actorType != null ? String(actorType) : null,
      actorId != null ? String(actorId) : null,
      action != null ? String(action) : null,
      targetType != null ? String(targetType) : null,
      targetId != null ? String(targetId) : null,
      detail != null ? String(detail) : null,
      ip != null ? String(ip) : null,
      brandId != null ? Number(brandId) : null,
      nowIso()
    )
    .catch((error) => {
      console.warn('recordAudit failed:', error?.message || error);
    });
}

async function listAuditLogs(db, { brandId, actor, action, from, to, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (actor != null && String(actor).trim()) {
    whereClauses.push('actor_id = ?');
    params.push(String(actor).trim());
  }
  if (action != null && String(action).trim()) {
    whereClauses.push('action = ?');
    params.push(String(action).trim());
  }
  if (from != null && String(from).trim()) {
    whereClauses.push('datetime(created_at) >= datetime(?)');
    params.push(String(from).trim());
  }
  if (to != null && String(to).trim()) {
    whereClauses.push('datetime(created_at) <= datetime(?)');
    params.push(String(to).trim());
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('(actor_id LIKE ? OR action LIKE ? OR target_type LIKE ? OR target_id LIKE ? OR detail LIKE ?)');
    params.push(likeParam(q), likeParam(q), likeParam(q), likeParam(q), likeParam(q));
  }

  const fromSql = `FROM audit_logs
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id,
            actor_type AS actorType,
            actor_id AS actorId,
            action,
            target_type AS targetType,
            target_id AS targetId,
            detail,
            ip,
            brand_id AS brandId,
            created_at AS createdAt
     ${fromSql}
     ORDER BY id DESC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    // Legacy behavior: capped array response.
    return db.all(`${selectSql} LIMIT ?`, ...params, 100);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c ${fromSql}`, ...params);
  const items = await db.all(
    `${selectSql} LIMIT ? OFFSET ?`,
    ...params,
    pagination.limit,
    pagination.offset
  );
  return { items, total: Number(totalRow?.c || 0), limit: pagination.limit, offset: pagination.offset };
}

module.exports = {
  recordAudit,
  listAuditLogs
};

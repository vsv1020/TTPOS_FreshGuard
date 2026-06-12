const { requirePositiveInteger, likeParam, normalizePagination } = require('../lib/util');
const { getBrandById } = require('./brands');

// ─── Feature C: Label template CRUD ──────────────────────────────────────────

async function getLabelTemplateById(db, templateId) {
  return db.get(
    `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
            created_at AS createdAt
     FROM label_templates
     WHERE id = ?`,
    requirePositiveInteger(templateId, 'templateId')
  );
}

async function getDefaultLabelTemplate(db, { brandId } = {}) {
  if (brandId == null) {
    return undefined;
  }
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  return db.get(
    `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
            created_at AS createdAt
     FROM label_templates
     WHERE brand_id = ? AND is_default = 1
     ORDER BY id DESC
     LIMIT 1`,
    normalizedBrandId
  );
}

async function createLabelTemplate(db, { brandId, name, widthMm, heightMm, dpi, bodyTemplate, isDefault }) {
  const normalizedBrandId = requirePositiveInteger(brandId, 'brandId');
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('Template name is required');
  }
  const brand = await getBrandById(db, normalizedBrandId);
  if (!brand) {
    throw new Error('brandId not found');
  }

  const makeDefault = isDefault ? 1 : 0;

  await db.exec('BEGIN TRANSACTION');
  try {
    if (makeDefault) {
      await db.run('UPDATE label_templates SET is_default = 0 WHERE brand_id = ?', normalizedBrandId);
    }
    const result = await db.run(
      `INSERT INTO label_templates (brand_id, name, width_mm, height_mm, dpi, body_template, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      normalizedBrandId,
      normalizedName,
      widthMm != null ? Number(widthMm) : 60,
      heightMm != null ? Number(heightMm) : 40,
      dpi != null ? Number(dpi) : 200,
      bodyTemplate != null ? String(bodyTemplate) : null,
      makeDefault
    );
    await db.exec('COMMIT');
    return getLabelTemplateById(db, result.lastID);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function listLabelTemplates(db, { brandId, q, limit, offset } = {}) {
  const whereClauses = ['1=1'];
  const params = [];

  if (brandId != null) {
    whereClauses.push('brand_id = ?');
    params.push(requirePositiveInteger(brandId, 'brandId'));
  }
  if (q != null && String(q).trim()) {
    whereClauses.push('name LIKE ?');
    params.push(likeParam(q));
  }

  const fromSql = `FROM label_templates
     WHERE ${whereClauses.join(' AND ')}`;
  const selectSql = `SELECT id,
            brand_id AS brandId,
            name,
            width_mm AS widthMm,
            height_mm AS heightMm,
            dpi,
            body_template AS bodyTemplate,
            is_default AS isDefault,
            created_at AS createdAt
     ${fromSql}
     ORDER BY id ASC`;

  const pagination = normalizePagination({ limit, offset });
  if (!pagination) {
    return db.all(selectSql, ...params);
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

const LABEL_TEMPLATE_COLUMN_MAP = {
  name: 'name',
  widthMm: 'width_mm',
  heightMm: 'height_mm',
  dpi: 'dpi',
  bodyTemplate: 'body_template'
};

async function updateLabelTemplate(db, templateId, fields = {}) {
  const normalizedTemplateId = requirePositiveInteger(templateId, 'templateId');
  const existing = await getLabelTemplateById(db, normalizedTemplateId);
  if (!existing) {
    throw new Error('templateId not found');
  }

  await db.exec('BEGIN TRANSACTION');
  try {
    const assignments = [];
    const values = [];
    for (const [key, rawValue] of Object.entries(fields)) {
      const column = LABEL_TEMPLATE_COLUMN_MAP[key];
      if (!column || rawValue === undefined) {
        continue;
      }
      let value = rawValue;
      if (key === 'name') {
        value = String(rawValue || '').trim();
        if (!value) {
          throw new Error('Template name is required');
        }
      } else if (key === 'widthMm' || key === 'heightMm' || key === 'dpi') {
        value = Number(rawValue);
      } else if (key === 'bodyTemplate') {
        value = rawValue != null ? String(rawValue) : null;
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    if (fields.isDefault !== undefined) {
      if (fields.isDefault) {
        await db.run('UPDATE label_templates SET is_default = 0 WHERE brand_id = ?', existing.brandId);
        assignments.push('is_default = ?');
        values.push(1);
      } else {
        assignments.push('is_default = ?');
        values.push(0);
      }
    }

    if (assignments.length > 0) {
      values.push(normalizedTemplateId);
      await db.run(`UPDATE label_templates SET ${assignments.join(', ')} WHERE id = ?`, ...values);
    }
    await db.exec('COMMIT');
    return getLabelTemplateById(db, normalizedTemplateId);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function deleteLabelTemplate(db, templateId) {
  const normalizedTemplateId = requirePositiveInteger(templateId, 'templateId');
  const existing = await getLabelTemplateById(db, normalizedTemplateId);
  if (!existing) {
    throw new Error('templateId not found');
  }
  await db.run('DELETE FROM label_templates WHERE id = ?', normalizedTemplateId);
  return existing;
}

module.exports = {
  getLabelTemplateById,
  getDefaultLabelTemplate,
  createLabelTemplate,
  listLabelTemplates,
  updateLabelTemplate,
  deleteLabelTemplate
};

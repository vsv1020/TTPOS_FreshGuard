const express = require('express');
const {
  createProduct,
  deleteProduct,
  getProductById,
  importProductsCsv,
  listProducts,
  recordAudit,
  updateProduct
} = require('../db');
const { respondDataError, sendList, sendCsv, PRODUCT_CSV_COLUMNS } = require('../lib/http');

function buildAdminProductsRoutes({ db, adminApiAuth }) {
  const router = express.Router();

  router.get('/api/admin/products', adminApiAuth, async (req, res) => {
    try {
      const effectiveBrandId = req.admin.brandId != null ? req.admin.brandId : req.query.brandId;
      const result = await listProducts(db, {
        brandId: effectiveBrandId,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset
      });

      // P1-2: CSV export (same format=csv pattern as the expired-handling report).
      if (req.query.format === 'csv') {
        const rows = Array.isArray(result) ? result : result.items;
        return sendCsv(res, 'products.csv', PRODUCT_CSV_COLUMNS, rows);
      }

      return sendList(res, 'products', result);
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  // P1-2: empty CSV template whose header matches the import field names.
  router.get('/api/admin/products/import-template.csv', adminApiAuth, (_req, res) => {
    return sendCsv(res, 'products-import-template.csv', PRODUCT_CSV_COLUMNS, []);
  });

  // P1-2: CSV import. Upsert key: (brandId, sku) when sku is present, else
  // (brandId, name) — see importProductsCsv in db.js. Valid rows commit even
  // when other rows fail (partial success), reported via errors + message.
  router.post('/api/admin/products/import', adminApiAuth, async (req, res) => {
    try {
      const result = await importProductsCsv(db, {
        csv: req.body?.csv,
        brandId: req.admin.brandId != null ? req.admin.brandId : undefined
      });
      recordAudit(db, {
        actorType: 'admin',
        actorId: req.admin.email,
        action: 'product.import',
        targetType: 'product',
        targetId: null,
        detail: `inserted=${result.inserted} updated=${result.updated} errors=${result.errors.length}`,
        ip: req.ip,
        brandId: req.admin.brandId != null ? req.admin.brandId : null
      });
      return res.json({
        ...result,
        message: result.errors.length > 0
          ? `Imported ${result.inserted + result.updated} valid rows (${result.inserted} inserted, ${result.updated} updated); ${result.errors.length} rows failed and were skipped.`
          : `Imported ${result.inserted + result.updated} rows (${result.inserted} inserted, ${result.updated} updated).`
      });
    } catch (error) {
      return respondDataError(res, error);
    }
  });

  router.post('/api/admin/products', adminApiAuth, async (req, res) => {
    try {
      const product = await createProduct(db, {
        brandId: req.body?.brandId,
        name: req.body?.name,
        sku: req.body?.sku,
        shelfLifeDays: req.body?.shelfLifeDays,
        shelfLifeHours: req.body?.shelfLifeHours,
        labelLanguage: req.body?.labelLanguage,
        primaryLanguage: req.body?.primaryLanguage,
        secondaryLanguage: req.body?.secondaryLanguage,
        allergens: req.body?.allergens,
        storageConditions: req.body?.storageConditions,
        openedShelfLifeHours: req.body?.openedShelfLifeHours,
        costPrice: req.body?.costPrice,
        colorCode: req.body?.colorCode
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

  router.patch('/api/admin/products/:id', adminApiAuth, async (req, res) => {
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
        shelfLifeHours: req.body?.shelfLifeHours,
        labelLanguage: req.body?.labelLanguage,
        primaryLanguage: req.body?.primaryLanguage,
        secondaryLanguage: req.body?.secondaryLanguage,
        allergens: req.body?.allergens,
        storageConditions: req.body?.storageConditions,
        openedShelfLifeHours: req.body?.openedShelfLifeHours,
        costPrice: req.body?.costPrice,
        colorCode: req.body?.colorCode
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

  router.delete('/api/admin/products/:id', adminApiAuth, async (req, res) => {
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

  return router;
}

module.exports = { buildAdminProductsRoutes };

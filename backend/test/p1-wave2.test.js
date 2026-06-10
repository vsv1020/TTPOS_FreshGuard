/**
 * p1-wave2.test.js
 * Covers:
 * - P1-2: products CSV template/export/import (upsert by (brandId, sku) then
 *   (brandId, name), partial success with per-line errors, brand scoping,
 *   viewer 403).
 * - P1-3: products.cost_price + GET /api/admin/reports/waste aggregation
 *   (summary/byStore/byProduct/byReason/trend, missingCostCount, filters,
 *   brand-admin auto scoping).
 * - P1-4/P1-5: GET /api/store/batches/by-barcode and
 *   GET /api/store/batches/:id/label (label shape identical to /api/store/print,
 *   cross-store lookups are 404).
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { PRODUCT_CSV_FIELDS, closeDb, createDb, ensureAdminUser } = require('../src/db');

const JWT_SECRET = 'test-secret';

describe('P1 wave 2: CSV import/export, waste report, scan + reprint', () => {
  let db;
  let app;
  let platformToken;
  let brandAId;
  let brandBId;
  let store1Id;
  let store2Id;
  let store1Token;
  let store2Token;
  let brandBAdminToken;
  let viewerToken;

  async function bindStore(storeId, deviceId) {
    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ storeId, expiresInHours: 24 });
    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId });
    return bindRes.body.token;
  }

  async function createProductApi(payload) {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${platformToken}`)
      .send(payload);
    expect(res.status).toBe(201);
    return res.body.product;
  }

  beforeAll(async () => {
    db = await createDb(':memory:');
    await ensureAdminUser(db, {
      email: 'admin@freshguard.local',
      password: 'StrongPassword123!'
    });
    app = buildApp({
      db,
      jwtSecret: JWT_SECRET,
      adminWebDir: `${__dirname}/../admin-web`
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });
    platformToken = login.body.token;

    const brandA = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Wave2 Brand A' });
    brandAId = brandA.body.brand.id;
    const brandB = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Wave2 Brand B' });
    brandBId = brandB.body.brand.id;

    const store1 = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandAId, name: 'Wave2 Store 1' });
    store1Id = store1.body.store.id;
    const store2 = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandAId, name: 'Wave2 Store 2' });
    store2Id = store2.body.store.id;

    store1Token = await bindStore(store1Id, 'wave2-device-1');
    store2Token = await bindStore(store2Id, 'wave2-device-2');

    await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        email: 'wave2-brandb@x.local',
        password: 'BrandBPassword123!',
        role: 'brand_admin',
        brandId: brandBId
      });
    const brandBLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wave2-brandb@x.local', password: 'BrandBPassword123!' });
    brandBAdminToken = brandBLogin.body.token;

    await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'wave2-viewer@x.local', password: 'ViewerPassword123!', role: 'viewer' });
    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wave2-viewer@x.local', password: 'ViewerPassword123!' });
    viewerToken = viewerLogin.body.token;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe('P1-2: products CSV', () => {
    test('import template is a CSV whose header matches the import fields', async () => {
      const res = await request(app)
        .get('/api/admin/products/import-template.csv')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0].trim()).toBe(PRODUCT_CSV_FIELDS.join(','));
    });

    test('product create API accepts costPrice', async () => {
      const product = await createProductApi({
        brandId: brandAId,
        name: 'CSV Base',
        sku: 'CSV-1',
        shelfLifeDays: 3,
        labelLanguage: 'single',
        costPrice: 4.5
      });
      expect(product.costPrice).toBe(4.5);
    });

    test('import upserts valid rows and reports invalid rows with line numbers (partial success)', async () => {
      const csv = [
        'brandId,name,sku,shelfLifeDays,labelLanguage,costPrice',
        `${brandAId},Imported Cake,IMP-1,5,single,12.5`,
        `${brandAId},CSV Base Renamed,CSV-1,7,single,9.9`,
        `${brandAId},Bad Row,BAD-1,not-a-number,single,1`
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/products/import')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ csv });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);
      expect(res.body.updated).toBe(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].line).toBe(4);
      expect(res.body.errors[0].message).toContain('shelfLifeDays');
      expect(res.body.message).toContain('1 rows failed');

      const listRes = await request(app)
        .get('/api/admin/products')
        .query({ brandId: brandAId })
        .set('Authorization', `Bearer ${platformToken}`);
      const products = listRes.body.products;
      const imported = products.find((p) => p.sku === 'IMP-1');
      expect(imported).toBeDefined();
      expect(imported.name).toBe('Imported Cake');
      expect(imported.costPrice).toBe(12.5);
      const updated = products.find((p) => p.sku === 'CSV-1');
      expect(updated.name).toBe('CSV Base Renamed');
      expect(updated.shelfLifeDays).toBe(7);
      expect(updated.costPrice).toBe(9.9);
      expect(products.find((p) => p.sku === 'BAD-1')).toBeUndefined();
    });

    test('platform admin rows must carry brandId', async () => {
      const csv = [
        'brandId,name,sku,shelfLifeDays,labelLanguage',
        ',No Brand,NB-1,5,single'
      ].join('\n');
      const res = await request(app)
        .post('/api/admin/products/import')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ csv });
      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(0);
      expect(res.body.errors).toEqual([
        { line: 2, message: 'brandId is required' }
      ]);
    });

    test('brand-scoped admin imports into own brand; foreign brandId rows are rejected', async () => {
      const csv = [
        'brandId,name,sku,shelfLifeDays,labelLanguage',
        `,Brand B Bun,BB-1,4,single`,
        `${brandAId},Foreign Row,F-1,4,single`
      ].join('\n');
      const res = await request(app)
        .post('/api/admin/products/import')
        .set('Authorization', `Bearer ${brandBAdminToken}`)
        .send({ csv });
      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);
      expect(res.body.errors).toEqual([
        { line: 3, message: 'brandId is outside your brand scope' }
      ]);

      const listRes = await request(app)
        .get('/api/admin/products')
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      const bun = listRes.body.products.find((p) => p.sku === 'BB-1');
      expect(bun).toBeDefined();
      expect(bun.brandId).toBe(brandBId);
    });

    test('export via format=csv returns the same columns as the template', async () => {
      const res = await request(app)
        .get('/api/admin/products')
        .query({ brandId: brandAId, format: 'csv' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0].trim()).toBe(PRODUCT_CSV_FIELDS.join(','));
      expect(res.text).toContain('Imported Cake');
      expect(res.text).toContain('12.5');
    });

    test('viewer cannot import (403)', async () => {
      const res = await request(app)
        .post('/api/admin/products/import')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ csv: 'name,shelfLifeDays\nX,1' });
      expect(res.status).toBe(403);
    });
  });

  describe('P1-3: waste report', () => {
    let productW1Id;
    let productW2Id;
    let batchAId;
    let batchBId;

    async function printBatch(token, productId, quantity) {
      const res = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity });
      expect(res.status).toBe(201);
      return res.body.batch;
    }

    async function handleReminderApi(token, reminderId, reason) {
      const res = await request(app)
        .post(`/api/store/reminders/${reminderId}/handle`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason });
      expect(res.status).toBe(200);
    }

    beforeAll(async () => {
      const w1 = await createProductApi({
        brandId: brandAId,
        name: 'Waste Milk',
        sku: 'W-1',
        shelfLifeDays: 3,
        labelLanguage: 'single',
        costPrice: 10
      });
      productW1Id = w1.id;
      const w2 = await createProductApi({
        brandId: brandAId,
        name: 'Waste Bread',
        sku: 'W-2',
        shelfLifeDays: 3,
        labelLanguage: 'single'
      });
      productW2Id = w2.id;
      expect(w2.costPrice).toBeNull();

      const batchA = await printBatch(store1Token, productW1Id, 2);
      batchAId = batchA.id;
      const batchB = await printBatch(store1Token, productW2Id, 1);
      batchBId = batchB.id;
      await printBatch(store2Token, productW1Id, 1);

      const remindersRes = await request(app)
        .get('/api/store/reminders')
        .query({ status: 'all' })
        .set('Authorization', `Bearer ${store1Token}`);
      const reminders = remindersRes.body.reminders;
      const batchAReminders = reminders.filter((r) => r.batchId === batchAId);
      const batchBReminders = reminders.filter((r) => r.batchId === batchBId);
      expect(batchAReminders).toHaveLength(2);
      expect(batchBReminders).toHaveLength(1);

      // batch A: one unit discarded (cost 10), one sold; batch B: one unit
      // discarded with no cost configured.
      await handleReminderApi(store1Token, batchAReminders[0].id, 'discarded');
      await handleReminderApi(store1Token, batchAReminders[1].id, 'sold');
      await handleReminderApi(store1Token, batchBReminders[0].id, 'discarded');
    });

    test('aggregates summary, byStore, byProduct, byReason and trend', async () => {
      const res = await request(app)
        .get('/api/admin/reports/waste')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);

      expect(res.body.summary).toEqual({
        totalBatches: 3,
        discardedCount: 2,
        wasteRate: 2 / 3,
        discardAmount: 10,
        missingCostCount: 1
      });

      const store1Row = res.body.byStore.find((r) => r.storeId === store1Id);
      expect(store1Row).toMatchObject({
        storeName: 'Wave2 Store 1',
        totalBatches: 2,
        discardedCount: 2,
        wasteRate: 1,
        discardAmount: 10
      });
      const store2Row = res.body.byStore.find((r) => r.storeId === store2Id);
      expect(store2Row).toMatchObject({
        totalBatches: 1,
        discardedCount: 0,
        wasteRate: 0,
        discardAmount: 0
      });

      const w1Row = res.body.byProduct.find((r) => r.productId === productW1Id);
      expect(w1Row).toMatchObject({
        productName: 'Waste Milk',
        totalBatches: 2,
        discardedCount: 1,
        wasteRate: 0.5,
        discardAmount: 10
      });
      const w2Row = res.body.byProduct.find((r) => r.productId === productW2Id);
      expect(w2Row).toMatchObject({
        totalBatches: 1,
        discardedCount: 1,
        wasteRate: 1,
        discardAmount: 0
      });

      expect(res.body.byReason).toEqual(
        expect.arrayContaining([
          { reason: 'discarded', count: 2 },
          { reason: 'sold', count: 1 }
        ])
      );

      const today = new Date().toISOString().slice(0, 10);
      expect(res.body.trend).toEqual([
        { date: today, discardedCount: 2, discardAmount: 10 }
      ]);
    });

    test('storeId filter narrows the report', async () => {
      const res = await request(app)
        .get('/api/admin/reports/waste')
        .query({ storeId: store2Id })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.summary.totalBatches).toBe(1);
      expect(res.body.summary.discardedCount).toBe(0);
      expect(res.body.byStore).toHaveLength(1);
      expect(res.body.byStore[0].storeId).toBe(store2Id);
    });

    test('from filter excludes earlier batches and handling logs', async () => {
      const res = await request(app)
        .get('/api/admin/reports/waste')
        .query({ from: '2099-01-01' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({
        totalBatches: 0,
        discardedCount: 0,
        wasteRate: 0,
        discardAmount: 0,
        missingCostCount: 0
      });
      expect(res.body.byStore).toEqual([]);
      expect(res.body.trend).toEqual([]);
    });

    test('brand-scoped admin is automatically narrowed to its own brand', async () => {
      const res = await request(app)
        .get('/api/admin/reports/waste')
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.summary.totalBatches).toBe(0);
      expect(res.body.byStore).toEqual([]);
    });
  });

  describe('P1-4/P1-5: barcode scan + label reprint', () => {
    let printBody;
    let scanProductId;

    beforeAll(async () => {
      const product = await createProductApi({
        brandId: brandAId,
        name: 'Scan Yogurt',
        sku: 'SCAN-1',
        shelfLifeDays: 2,
        labelLanguage: 'single',
        costPrice: 6
      });
      scanProductId = product.id;
      const res = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${store1Token}`)
        .send({ productId: scanProductId, quantity: 1 });
      expect(res.status).toBe(201);
      printBody = res.body;
      expect(printBody.batch.barcodeData).toBeTruthy();
    });

    test('by-barcode resolves a batch with its earliest unhandled reminder', async () => {
      const res = await request(app)
        .get('/api/store/batches/by-barcode')
        .query({ code: printBody.batch.barcodeData })
        .set('Authorization', `Bearer ${store1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.batch.id).toBe(printBody.batch.id);
      expect(res.body.batch.productName).toBe('Scan Yogurt');
      expect(res.body.reminder).not.toBeNull();
      expect(res.body.reminder.batchId).toBe(printBody.batch.id);
      expect(res.body.reminder.handledAt).toBeNull();
    });

    test('unknown barcode returns 404 with a clear message', async () => {
      const res = await request(app)
        .get('/api/store/batches/by-barcode')
        .query({ code: 'FG-0-0-999999' })
        .set('Authorization', `Bearer ${store1Token}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('No batch found');
    });

    test('missing code is a 400', async () => {
      const res = await request(app)
        .get('/api/store/batches/by-barcode')
        .set('Authorization', `Bearer ${store1Token}`);
      expect(res.status).toBe(400);
    });

    test("another store cannot resolve this store's barcode (404)", async () => {
      const res = await request(app)
        .get('/api/store/batches/by-barcode')
        .query({ code: printBody.batch.barcodeData })
        .set('Authorization', `Bearer ${store2Token}`);
      expect(res.status).toBe(404);
    });

    test('label reprint matches the original print label shape and text', async () => {
      const res = await request(app)
        .get(`/api/store/batches/${printBody.batch.id}/label`)
        .set('Authorization', `Bearer ${store1Token}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.label).sort()).toEqual(
        Object.keys(printBody.label).sort()
      );
      expect(res.body.label.text).toBe(printBody.label.text);
      expect(res.body.label.barcodeData).toBe(printBody.batch.barcodeData);
      expect(res.body.label.productName).toBe('Scan Yogurt');
      expect(res.body.printerSettings).toEqual(printBody.printerSettings);
      expect(res.body.batch.id).toBe(printBody.batch.id);
    });

    test("another store cannot reprint this store's batch label (404)", async () => {
      const res = await request(app)
        .get(`/api/store/batches/${printBody.batch.id}/label`)
        .set('Authorization', `Bearer ${store2Token}`);
      expect(res.status).toBe(404);
    });

    test('unknown batch id is a 404', async () => {
      const res = await request(app)
        .get('/api/store/batches/999999/label')
        .set('Authorization', `Bearer ${store1Token}`);
      expect(res.status).toBe(404);
    });
  });
});

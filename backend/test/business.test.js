const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('Core business flow', () => {
  let db;
  let app;
  let adminToken;
  let sequence = 1;

  beforeAll(async () => {
    db = await createDb(':memory:');
    await ensureAdminUser(db, {
      email: 'admin@freshguard.local',
      password: 'StrongPassword123!'
    });
    app = buildApp({
      db,
      jwtSecret: 'test-secret',
      adminWebDir: `${__dirname}/../admin-web`
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });

    adminToken = login.body.token;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  function nextName(prefix) {
    const value = `${prefix}-${sequence}`;
    sequence += 1;
    return value;
  }

  async function setupBoundStore({
    shelfLifeDays = 2,
    labelLanguage = 'bilingual',
    primaryLanguage = 'en',
    secondaryLanguage = 'es'
  } = {}) {
    const brandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: nextName('Brand') });
    expect(brandRes.statusCode).toBe(201);
    const brandId = brandRes.body.brand.id;

    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId, name: nextName('Store') });
    expect(storeRes.statusCode).toBe(201);
    const storeId = storeRes.body.store.id;

    const productPayload = {
      brandId,
      name: nextName('Product'),
      sku: nextName('SKU'),
      shelfLifeDays,
      labelLanguage,
      primaryLanguage
    };

    if (labelLanguage === 'bilingual') {
      productPayload.secondaryLanguage = secondaryLanguage;
    }

    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(productPayload);
    expect(productRes.statusCode).toBe(201);
    const productId = productRes.body.product.id;

    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ storeId, expiresInHours: 24 });
    expect(codeRes.statusCode).toBe(201);
    const bindingCode = codeRes.body.bindingCode.code;

    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: bindingCode, deviceId: 'android-emulator-01' });
    expect(bindRes.statusCode).toBe(200);
    const storeToken = bindRes.body.token;

    return {
      brandId,
      storeId,
      productId,
      storeToken,
      storeName: bindRes.body.store.name,
      productName: productPayload.name,
      primaryLanguage,
      secondaryLanguage: productPayload.secondaryLanguage || null
    };
  }

  test('returns rendered label text and printer settings in /api/store/print response', async () => {
    const setup = await setupBoundStore({
      shelfLifeDays: 2,
      labelLanguage: 'bilingual',
      primaryLanguage: 'en',
      secondaryLanguage: 'es'
    });

    const settingsRes = await request(app)
      .patch(`/api/admin/stores/${setup.storeId}/printer-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        printerName: 'Zebra Front Desk',
        printerModel: 'ZD421',
        printerAddress: '192.168.0.88',
        printerPort: 9100,
        printerDpi: 203,
        labelWidthMm: 58
      });

    expect(settingsRes.statusCode).toBe(200);

    const storeProductsRes = await request(app)
      .get('/api/store/products')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(storeProductsRes.statusCode).toBe(200);
    expect(storeProductsRes.body.products).toHaveLength(1);

    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({
        productId: setup.productId,
        quantity: 2,
        printedAt: '2026-01-01T00:00:00.000Z'
      });

    expect(printRes.statusCode).toBe(201);
    expect(printRes.body.batch.quantity).toBe(2);
    expect(printRes.body.remindersCreated).toBe(2);
    expect(printRes.body.store.id).toBe(setup.storeId);
    expect(printRes.body.printerSettings).toMatchObject({
      printerName: 'Zebra Front Desk',
      printerModel: 'ZD421',
      printerAddress: '192.168.0.88',
      printerPort: 9100,
      printerDpi: 203,
      labelWidthMm: 58
    });
    expect(printRes.body.label).toMatchObject({
      productName: setup.productName,
      batchId: printRes.body.batch.id,
      storeName: setup.storeName,
      template: 'bilingual'
    });
    expect(printRes.body.label.languages).toEqual(['en', 'es']);
    expect(printRes.body.label.text).toContain(`Product: ${setup.productName}`);
    expect(printRes.body.label.text).toContain(`Batch ID: ${printRes.body.batch.id}`);
    expect(printRes.body.label.text).toContain(`Store: ${setup.storeName}`);
    expect(printRes.body.label.text).toContain('Languages: en, es');
  });

  test('supports status=expiring|expired|all with default thresholdDays=1', async () => {
    const setup = await setupBoundStore({
      shelfLifeDays: 1,
      labelLanguage: 'single',
      primaryLanguage: 'en'
    });

    const now = Date.now();
    const printedA = new Date(now).toISOString();
    const printedB = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const printedC = new Date(now + 1 * 24 * 60 * 60 * 1000).toISOString();

    const printA = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({ productId: setup.productId, quantity: 1, printedAt: printedA });
    expect(printA.statusCode).toBe(201);

    const printB = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({ productId: setup.productId, quantity: 1, printedAt: printedB });
    expect(printB.statusCode).toBe(201);

    const printC = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({ productId: setup.productId, quantity: 1, printedAt: printedC });
    expect(printC.statusCode).toBe(201);

    const expiringDefaultRes = await request(app)
      .get('/api/store/reminders?status=expiring')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(expiringDefaultRes.statusCode).toBe(200);

    const expiringDefaultBatchIds = expiringDefaultRes.body.reminders.map((item) => item.batchId);
    expect(expiringDefaultBatchIds).toContain(printA.body.batch.id);
    expect(expiringDefaultBatchIds).not.toContain(printB.body.batch.id);
    expect(expiringDefaultBatchIds).not.toContain(printC.body.batch.id);

    const expiringThresholdTwoRes = await request(app)
      .get('/api/store/reminders?status=expiring&thresholdDays=2')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(expiringThresholdTwoRes.statusCode).toBe(200);

    const expiringThresholdTwoBatchIds = expiringThresholdTwoRes.body.reminders.map((item) => item.batchId);
    expect(expiringThresholdTwoBatchIds).toContain(printA.body.batch.id);
    expect(expiringThresholdTwoBatchIds).toContain(printC.body.batch.id);
    expect(expiringThresholdTwoBatchIds).not.toContain(printB.body.batch.id);

    const expiredRes = await request(app)
      .get('/api/store/reminders?status=expired')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(expiredRes.statusCode).toBe(200);

    const expiredBatchIds = expiredRes.body.reminders.map((item) => item.batchId);
    expect(expiredBatchIds).toContain(printB.body.batch.id);
    expect(expiredBatchIds).not.toContain(printA.body.batch.id);
    expect(expiredBatchIds).not.toContain(printC.body.batch.id);

    const allRes = await request(app)
      .get('/api/store/reminders?status=all')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(allRes.statusCode).toBe(200);
    expect(allRes.body.reminders).toHaveLength(3);
  });

  test('supports reminder handling and expired report aggregation by store and product', async () => {
    const setup = await setupBoundStore({
      shelfLifeDays: 2,
      labelLanguage: 'bilingual',
      primaryLanguage: 'en',
      secondaryLanguage: 'es'
    });

    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({
        productId: setup.productId,
        quantity: 2,
        printedAt: '2001-01-01T00:00:00.000Z'
      });

    expect(printRes.statusCode).toBe(201);

    const expiredRes = await request(app)
      .get('/api/store/reminders?status=expired')
      .set('Authorization', `Bearer ${setup.storeToken}`);
    expect(expiredRes.statusCode).toBe(200);
    expect(expiredRes.body.reminders.length).toBeGreaterThan(0);

    const reminderId = expiredRes.body.reminders[0].id;

    const handleRes = await request(app)
      .post(`/api/store/reminders/${reminderId}/handle`)
      .set('Authorization', `Bearer ${setup.storeToken}`)
      .send({ reason: 'sold' });
    expect(handleRes.statusCode).toBe(200);
    expect(handleRes.body.reminder.handledAt).toBeTruthy();

    const reportRes = await request(app)
      .get('/api/admin/reports/expired-handling')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reportRes.statusCode).toBe(200);
    expect(reportRes.body.rows.length).toBeGreaterThan(0);

    const row = reportRes.body.rows.find(
      (item) => item.storeId === setup.storeId && item.productId === setup.productId
    );
    expect(row).toBeTruthy();
    expect(row.expiredHandledCount).toBe(1);
    expect(row.expiredUnhandledCount).toBe(1);
  });
});

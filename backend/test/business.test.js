const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('Core business flow', () => {
  let db;
  let app;
  let adminToken;

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

  test('supports brand/store binding, printing, reminders handling, and expired report', async () => {
    const brandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Acme Foods' });
    expect(brandRes.statusCode).toBe(201);
    const brandId = brandRes.body.brand.id;

    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId, name: 'Downtown' });
    expect(storeRes.statusCode).toBe(201);
    const storeId = storeRes.body.store.id;

    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId,
        name: 'Salad Bowl',
        sku: 'SB-1',
        shelfLifeDays: 2,
        labelLanguage: 'bilingual',
        primaryLanguage: 'en',
        secondaryLanguage: 'es'
      });
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
    expect(bindRes.body.token).toBeTruthy();

    const storeToken = bindRes.body.token;

    const storeProductsRes = await request(app)
      .get('/api/store/products')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(storeProductsRes.statusCode).toBe(200);
    expect(storeProductsRes.body.products).toHaveLength(1);

    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        productId,
        quantity: 2,
        printedAt: '2001-01-01T00:00:00.000Z'
      });

    expect(printRes.statusCode).toBe(201);
    expect(printRes.body.batch.quantity).toBe(2);
    expect(printRes.body.remindersCreated).toBe(2);

    const expiredRes = await request(app)
      .get('/api/store/reminders?status=expired')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(expiredRes.statusCode).toBe(200);
    expect(expiredRes.body.reminders.length).toBeGreaterThan(0);

    const reminderId = expiredRes.body.reminders[0].id;

    const handleRes = await request(app)
      .post(`/api/store/reminders/${reminderId}/handle`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ reason: 'sold' });
    expect(handleRes.statusCode).toBe(200);
    expect(handleRes.body.reminder.handledAt).toBeTruthy();

    const reportRes = await request(app)
      .get('/api/admin/reports/expired-handling')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reportRes.statusCode).toBe(200);
    expect(reportRes.body.rows.length).toBeGreaterThan(0);

    const row = reportRes.body.rows.find((item) => item.storeId === storeId && item.productId === productId);
    expect(row).toBeTruthy();
    expect(row.expiredHandledCount).toBe(1);
    expect(row.expiredUnhandledCount).toBe(1);
  });
});

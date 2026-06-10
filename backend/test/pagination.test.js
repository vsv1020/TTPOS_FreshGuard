/**
 * pagination.test.js
 * Covers the unified list API contract:
 * - pagination envelope ({ items, total, limit, offset }) when `limit` is given
 * - legacy array responses when `limit` is absent (backward compatibility)
 * - keyword search via `q`
 * - FIFO/FEFO ordering + is_priority on store reminders
 * - brand-level reminder-config (GET/PUT) and its effect on the default threshold
 * - audit-log filters (actor/action)
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('List pagination / FIFO / reminder-config contract', () => {
  let db;
  let app;
  let adminToken;
  let brandId;
  let storeId;
  let storeToken;
  let appleProductId;
  let cherryProductId;

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

    const brandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Pag Brand' });
    brandId = brandRes.body.brand.id;

    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId, name: 'Pag Store' });
    storeId = storeRes.body.store.id;

    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ storeId, expiresInHours: 24 });
    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: 'pag-device-01' });
    storeToken = bindRes.body.token;

    const productPayloads = [
      { name: 'Pag Apple', shelfLifeDays: 3 },
      { name: 'Pag Banana', shelfLifeDays: 3 },
      { name: 'Pag Cherry', shelfLifeDays: 10 }
    ];
    for (const payload of productPayloads) {
      const res = await request(app)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ brandId, labelLanguage: 'single', ...payload });
      expect(res.statusCode).toBe(201);
      if (payload.name === 'Pag Apple') appleProductId = res.body.product.id;
      if (payload.name === 'Pag Cherry') cherryProductId = res.body.product.id;
    }
  });

  afterAll(async () => {
    await closeDb(db);
  });

  test('admin products without limit keeps legacy array response', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.items).toBeUndefined();
    expect(res.body.products.length).toBe(3);
  });

  test('admin products with limit returns pagination envelope', async () => {
    const page1 = await request(app)
      .get('/api/admin/products')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(page1.statusCode).toBe(200);
    expect(page1.body.products).toBeUndefined();
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.total).toBe(3);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.offset).toBe(0);

    const page2 = await request(app)
      .get('/api/admin/products')
      .query({ limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(page2.body.items.length).toBe(1);
    expect(page2.body.total).toBe(3);
    expect(page2.body.offset).toBe(2);
  });

  test('admin products q filters in SQL and total reflects the filter', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .query({ q: 'Banana', limit: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe('Pag Banana');
  });

  test('store reminders are FIFO (expires_at ASC) with is_priority on earliest batch', async () => {
    const now = Date.now();
    // Older batch: printed 2 days ago -> expires sooner.
    const oldPrint = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        productId: appleProductId,
        quantity: 1,
        printedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
      });
    expect(oldPrint.statusCode).toBe(201);
    const newPrint = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ productId: appleProductId, quantity: 1 });
    expect(newPrint.statusCode).toBe(201);

    const res = await request(app)
      .get('/api/store/reminders')
      .query({ status: 'all', q: 'Pag Apple' })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.reminders)).toBe(true);
    expect(res.body.reminders.length).toBe(2);

    const [first, second] = res.body.reminders;
    expect(new Date(first.expiresAt).getTime()).toBeLessThan(new Date(second.expiresAt).getTime());
    expect(first.is_priority).toBe(true);
    expect(second.is_priority).toBe(false);
  });

  test('store reminders with limit returns envelope', async () => {
    const res = await request(app)
      .get('/api/store/reminders')
      .query({ status: 'all', q: 'Pag Apple', limit: 1 })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.reminders).toBeUndefined();
    expect(res.body.items.length).toBe(1);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].is_priority).toBe(true);
  });

  test('audit logs keep legacy array without limit and filter by actor/action with envelope', async () => {
    const legacy = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(legacy.statusCode).toBe(200);
    expect(Array.isArray(legacy.body.logs)).toBe(true);

    const filtered = await request(app)
      .get('/api/admin/audit-logs')
      .query({ action: 'product.create', actor: 'admin@freshguard.local', limit: 2 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.body.total).toBe(3);
    expect(filtered.body.items.length).toBe(2);
    for (const item of filtered.body.items) {
      expect(item.action).toBe('product.create');
      expect(item.actorId).toBe('admin@freshguard.local');
    }
  });

  test('brand reminder-config GET/PUT and default threshold applies to store reminders', async () => {
    const before = await request(app)
      .get(`/api/admin/brands/${brandId}/reminder-config`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.statusCode).toBe(200);
    expect(before.body.reminderConfig).toEqual({ brandId, thresholdDays: 1 });

    // Cherry expires in 10 days: outside the default 1-day expiring window.
    const print = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ productId: cherryProductId, quantity: 1 });
    expect(print.statusCode).toBe(201);

    const narrow = await request(app)
      .get('/api/store/reminders')
      .query({ status: 'expiring', q: 'Pag Cherry' })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(narrow.body.reminders.length).toBe(0);

    const put = await request(app)
      .put(`/api/admin/brands/${brandId}/reminder-config`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ thresholdDays: 15 });
    expect(put.statusCode).toBe(200);
    expect(put.body.reminderConfig).toEqual({ brandId, thresholdDays: 15 });

    const wide = await request(app)
      .get('/api/store/reminders')
      .query({ status: 'expiring', q: 'Pag Cherry' })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(wide.body.reminders.length).toBe(1);

    // Explicit thresholdDays still overrides the brand config.
    const explicit = await request(app)
      .get('/api/store/reminders')
      .query({ status: 'expiring', q: 'Pag Cherry', thresholdDays: 1 })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(explicit.body.reminders.length).toBe(0);
  });
});

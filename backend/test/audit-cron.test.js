/**
 * audit-cron.test.js
 * Covers:
 * - P0-5 越权修复: GET /api/admin/audit-logs is brand-scoped for brand admins,
 *   platform admins still see everything.
 * - New audit points (brand/store/binding-code create) carry brand_id.
 * - P0-1 cron scan (runReminderScan): marks overdue/expiring using the brand
 *   reminder threshold, backfills missing reminders, and is idempotent.
 */
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser, runReminderScan } = require('../src/db');

describe('Audit brand scoping + reminder scan cron', () => {
  let db;
  let app;
  let platformToken;
  let brandAToken;
  let brandAId;
  let brandBId;
  let storeAId;
  let storeBId;
  let storeAToken;
  let shortProductId; // expires within brand threshold
  let longProductId; // expires outside brand threshold

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
    platformToken = login.body.token;

    const brandA = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Audit Brand A' });
    brandAId = brandA.body.brand.id;
    const brandB = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Audit Brand B' });
    brandBId = brandB.body.brand.id;

    const storeA = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandAId, name: 'Audit Store A' });
    storeAId = storeA.body.store.id;
    const storeB = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandBId, name: 'Audit Store B' });
    storeBId = storeB.body.store.id;

    // Brand-scoped admin for brand A (logs in like any other admin).
    const pinHash = await bcrypt.hash('BrandAdmin123!', 4);
    await db.run(
      `INSERT INTO users (email, password_hash, role, brand_id) VALUES (?, ?, 'admin', ?)`,
      'brand-a@freshguard.local',
      pinHash,
      brandAId
    );
    const brandLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'brand-a@freshguard.local', password: 'BrandAdmin123!' });
    expect(brandLogin.statusCode).toBe(200);
    brandAToken = brandLogin.body.token;

    // Bind store A for store-side printing.
    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ storeId: storeAId, expiresInHours: 24 });
    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: 'audit-device-01' });
    storeAToken = bindRes.body.token;

    const shortRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandAId, name: 'Audit Short Life', shelfLifeDays: 3, labelLanguage: 'single' });
    shortProductId = shortRes.body.product.id;
    const longRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId: brandAId, name: 'Audit Long Life', shelfLifeDays: 30, labelLanguage: 'single' });
    longProductId = longRes.body.product.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  test('new audit points are written with brand scope', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.statusCode).toBe(200);
    const actions = res.body.items.map((l) => `${l.action}:${l.brandId}`);
    expect(actions).toContain(`brand.create:${brandAId}`);
    expect(actions).toContain(`brand.create:${brandBId}`);
    expect(actions).toContain(`store.create:${brandAId}`);
    expect(actions).toContain(`store.create:${brandBId}`);
    expect(actions).toContain(`binding-code.create:${brandAId}`);
  });

  test('brand-scoped admin only sees own-brand audit logs (越权修复)', async () => {
    // Legacy array response.
    const legacy = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${brandAToken}`);
    expect(legacy.statusCode).toBe(200);
    expect(Array.isArray(legacy.body.logs)).toBe(true);
    expect(legacy.body.logs.length).toBeGreaterThan(0);
    for (const log of legacy.body.logs) {
      expect(log.brandId).toBe(brandAId);
    }
    // No brand-B trail leaks through.
    const brandBLeak = legacy.body.logs.filter(
      (l) => l.action === 'store.create' && String(l.targetId) === String(storeBId)
    );
    expect(brandBLeak.length).toBe(0);

    // Pagination envelope keeps the same scope.
    const paged = await request(app)
      .get('/api/admin/audit-logs')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${brandAToken}`);
    expect(paged.statusCode).toBe(200);
    for (const log of paged.body.items) {
      expect(log.brandId).toBe(brandAId);
    }

    // Platform admin still sees both brands.
    const platform = await request(app)
      .get('/api/admin/audit-logs')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${platformToken}`);
    const brandIds = new Set(platform.body.items.map((l) => l.brandId));
    expect(brandIds.has(brandAId)).toBe(true);
    expect(brandIds.has(brandBId)).toBe(true);
    expect(platform.body.total).toBeGreaterThan(paged.body.total);
  });

  test('runReminderScan marks overdue/expiring per brand threshold and is idempotent', async () => {
    // Widen brand A's expiring window so the 3-day product falls inside it
    // while the 30-day product stays outside.
    const put = await request(app)
      .put(`/api/admin/brands/${brandAId}/reminder-config`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ thresholdDays: 5 });
    expect(put.statusCode).toBe(200);

    // Expired batch: printed 10 days ago with a 3-day shelf life.
    const expiredPrint = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({
        productId: shortProductId,
        quantity: 2,
        printedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      });
    expect(expiredPrint.statusCode).toBe(201);
    const expiredBatchId = expiredPrint.body.batch.id;

    // Expiring batch: printed now, expires in 3 days (inside the 5-day window).
    const expiringPrint = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ productId: shortProductId, quantity: 1 });
    const expiringBatchId = expiringPrint.body.batch.id;

    // Far batch: expires in 30 days (outside the window), must stay pending.
    const farPrint = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ productId: longProductId, quantity: 1 });
    const farBatchId = farPrint.body.batch.id;

    const first = await runReminderScan(db);
    expect(first.markedOverdue).toBe(2);
    expect(first.markedExpiring).toBe(1);
    expect(first.backfilled).toBe(0);

    const statusFor = async (batchId) =>
      db.all('SELECT status FROM reminders WHERE batch_id = ?', batchId);
    expect((await statusFor(expiredBatchId)).map((r) => r.status)).toEqual(['overdue', 'overdue']);
    expect((await statusFor(expiringBatchId)).map((r) => r.status)).toEqual(['expiring']);
    expect((await statusFor(farBatchId)).map((r) => r.status)).toEqual(['pending']);

    // Idempotent: a second pass changes nothing and creates no duplicates.
    const countBefore = (await db.get('SELECT COUNT(*) AS c FROM reminders')).c;
    const second = await runReminderScan(db);
    expect(second).toEqual({ backfilled: 0, markedOverdue: 0, markedExpiring: 0 });
    const countAfter = (await db.get('SELECT COUNT(*) AS c FROM reminders')).c;
    expect(countAfter).toBe(countBefore);
  });

  test('runReminderScan backfills reminders for a batch that lost them, exactly once', async () => {
    const print = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ productId: longProductId, quantity: 3 });
    expect(print.statusCode).toBe(201);
    const batchId = print.body.batch.id;

    await db.run('DELETE FROM reminders WHERE batch_id = ?', batchId);

    const first = await runReminderScan(db);
    expect(first.backfilled).toBe(3);
    const rows = await db.all(
      'SELECT status, expires_at AS expiresAt FROM reminders WHERE batch_id = ?',
      batchId
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.expiresAt).toBe(print.body.batch.expiresAt);
    }

    const second = await runReminderScan(db);
    expect(second.backfilled).toBe(0);
    const countAfter = (await db.get('SELECT COUNT(*) AS c FROM reminders WHERE batch_id = ?', batchId)).c;
    expect(countAfter).toBe(3);
  });

  test('handled reminders are never touched by the scan', async () => {
    const print = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({
        productId: shortProductId,
        quantity: 1,
        printedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      });
    const batchId = print.body.batch.id;
    const reminder = await db.get('SELECT id FROM reminders WHERE batch_id = ?', batchId);

    const handle = await request(app)
      .post(`/api/store/reminders/${reminder.id}/handle`)
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ reason: 'discarded' });
    expect(handle.statusCode).toBe(200);

    const result = await runReminderScan(db);
    expect(result.markedOverdue).toBe(0);
    const after = await db.get('SELECT status FROM reminders WHERE id = ?', reminder.id);
    expect(after.status).toBe('handled');
  });
});

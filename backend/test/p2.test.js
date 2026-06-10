/**
 * p2.test.js
 * Covers:
 * - P2-2: products.color_code four-color coding (enum validation on CRUD,
 *   CSV import/export colorCode column, label colorCode/colorLabel +
 *   {{colorLabel}} template placeholder, monochrome text marker on labels).
 * - P2-5: dashboard drilldown (from/to/brandId/storeId on the existing
 *   aggregation endpoints) + GET /api/admin/dashboard/store-ranking
 *   (handleRate / wasteRate / avgInspectionScore / openIssues /
 *   overdueIssues, brand-admin auto narrowing).
 * - P2-4: issue closure loop (assignee/dueDate, forward-only status flow
 *   pending(open) -> in_progress -> resolved -> closed with 400 on illegal
 *   transitions, overdue filter + computed overdue flag).
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { PRODUCT_CSV_FIELDS, closeDb, createDb, ensureAdminUser } = require('../src/db');

const JWT_SECRET = 'test-secret';

describe('P2: color code, dashboard drilldown, issue closure', () => {
  let db;
  let app;
  let platformToken;
  let brandAId;
  let brandBId;
  let store1Id;
  let storeRId;
  let storeEmptyId;
  let store1Token;
  let storeRToken;
  let brandBAdminToken;

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

  async function createStoreApi(brandId, name) {
    const res = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId, name });
    expect(res.status).toBe(201);
    return res.body.store.id;
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
      .send({ name: 'P2 Brand A' });
    brandAId = brandA.body.brand.id;
    const brandB = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'P2 Brand B' });
    brandBId = brandB.body.brand.id;

    store1Id = await createStoreApi(brandAId, 'P2 Store 1');
    storeRId = await createStoreApi(brandAId, 'P2 Ranking Store');
    storeEmptyId = await createStoreApi(brandAId, 'P2 Empty Store');
    store1Token = await bindStore(store1Id, 'p2-device-1');
    storeRToken = await bindStore(storeRId, 'p2-device-r');

    await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        email: 'p2-brandb@x.local',
        password: 'BrandBPassword123!',
        role: 'brand_admin',
        brandId: brandBId
      });
    const brandBLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'p2-brandb@x.local', password: 'BrandBPassword123!' });
    brandBAdminToken = brandBLogin.body.token;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe('P2-2: four-color coding', () => {
    let redProductId;
    let plainProductId;

    test('create accepts a valid colorCode and returns it', async () => {
      const product = await createProductApi({
        brandId: brandAId,
        name: 'Color Beef',
        sku: 'COL-RED',
        shelfLifeDays: 3,
        labelLanguage: 'single',
        colorCode: 'red'
      });
      redProductId = product.id;
      expect(product.colorCode).toBe('red');
    });

    test('create rejects an unknown colorCode (400)', async () => {
      const res = await request(app)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          brandId: brandAId,
          name: 'Color Bad',
          shelfLifeDays: 3,
          labelLanguage: 'single',
          colorCode: 'purple'
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('colorCode');
    });

    test('colorCode defaults to null and patch can set/clear/reject it', async () => {
      const product = await createProductApi({
        brandId: brandAId,
        name: 'Color Plain',
        sku: 'COL-PLAIN',
        shelfLifeDays: 3,
        labelLanguage: 'single'
      });
      plainProductId = product.id;
      expect(product.colorCode).toBeNull();

      const blueRes = await request(app)
        .patch(`/api/admin/products/${redProductId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ colorCode: 'blue' });
      expect(blueRes.status).toBe(200);
      expect(blueRes.body.product.colorCode).toBe('blue');

      const badRes = await request(app)
        .patch(`/api/admin/products/${redProductId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ colorCode: 'rainbow' });
      expect(badRes.status).toBe(400);

      const clearRes = await request(app)
        .patch(`/api/admin/products/${redProductId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ colorCode: '' });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.product.colorCode).toBeNull();

      // Restore red for the label tests below.
      const restoreRes = await request(app)
        .patch(`/api/admin/products/${redProductId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ colorCode: 'red' });
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.product.colorCode).toBe('red');
    });

    test('CSV template/export include the colorCode column and import validates it', async () => {
      const templateRes = await request(app)
        .get('/api/admin/products/import-template.csv')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(templateRes.status).toBe(200);
      expect(templateRes.text.split('\n')[0].trim()).toBe(PRODUCT_CSV_FIELDS.join(','));
      expect(PRODUCT_CSV_FIELDS).toContain('colorCode');

      const csv = [
        'brandId,name,sku,shelfLifeDays,labelLanguage,colorCode',
        `${brandAId},Color Lettuce,COL-GRN,2,single,green`,
        `${brandAId},Color Bad Row,COL-BAD,2,single,pink`
      ].join('\n');
      const importRes = await request(app)
        .post('/api/admin/products/import')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ csv });
      expect(importRes.status).toBe(200);
      expect(importRes.body.inserted).toBe(1);
      expect(importRes.body.errors).toHaveLength(1);
      expect(importRes.body.errors[0].line).toBe(3);
      expect(importRes.body.errors[0].message).toContain('colorCode');

      const exportRes = await request(app)
        .get('/api/admin/products')
        .query({ brandId: brandAId, format: 'csv' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(exportRes.status).toBe(200);
      const lettuceLine = exportRes.text.split('\n').find((l) => l.includes('COL-GRN'));
      expect(lettuceLine).toContain('green');
    });

    test('print label carries colorCode/colorLabel and the monochrome text marker', async () => {
      const res = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${store1Token}`)
        .send({ productId: redProductId, quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.body.label.colorCode).toBe('red');
      expect(res.body.label.colorLabel).toBe('红·畜肉禽类');
      expect(res.body.label.fields.colorLabel).toBe('红·畜肉禽类');
      expect(res.body.label.text).toContain('色标: 红·畜肉禽类');
    });

    test('label reprint keeps the same colorLabel', async () => {
      const printRes = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${store1Token}`)
        .send({ productId: redProductId, quantity: 1 });
      const reprintRes = await request(app)
        .get(`/api/store/batches/${printRes.body.batch.id}/label`)
        .set('Authorization', `Bearer ${store1Token}`);
      expect(reprintRes.status).toBe(200);
      expect(reprintRes.body.label.colorCode).toBe('red');
      expect(reprintRes.body.label.colorLabel).toBe('红·畜肉禽类');
      expect(reprintRes.body.label.text).toBe(printRes.body.label.text);
    });

    test('product without colorCode prints with null color fields and no marker line', async () => {
      const res = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${store1Token}`)
        .send({ productId: plainProductId, quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.body.label.colorCode).toBeNull();
      expect(res.body.label.colorLabel).toBeNull();
      expect(res.body.label.text).not.toContain('色标');
    });

    test('custom label template can use the {{colorLabel}} placeholder', async () => {
      const templateRes = await request(app)
        .post('/api/admin/label-templates')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          brandId: brandAId,
          name: 'P2 Color Template',
          bodyTemplate: 'COLOR={{colorLabel}} P={{product_name}}',
          isDefault: true
        });
      expect(templateRes.status).toBe(201);

      const res = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${store1Token}`)
        .send({ productId: redProductId, quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.body.label.text).toBe('COLOR=红·畜肉禽类 P=Color Beef');

      // Remove the default template so later prints fall back to the builtin layout.
      const deleteRes = await request(app)
        .delete(`/api/admin/label-templates/${templateRes.body.template.id}`)
        .set('Authorization', `Bearer ${platformToken}`);
      expect(deleteRes.status).toBe(200);
    });
  });

  describe('P2-5: dashboard drilldown + store-ranking', () => {
    let rankProductId;

    beforeAll(async () => {
      const product = await createProductApi({
        brandId: brandAId,
        name: 'Rank Milk',
        sku: 'RANK-1',
        shelfLifeDays: 3,
        labelLanguage: 'single',
        costPrice: 10
      });
      rankProductId = product.id;

      // Two batches at the ranking store: 4 reminders total.
      const batchA = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ productId: rankProductId, quantity: 2 });
      expect(batchA.status).toBe(201);
      const batchB = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ productId: rankProductId, quantity: 2 });
      expect(batchB.status).toBe(201);

      const remindersRes = await request(app)
        .get('/api/store/reminders')
        .query({ status: 'all' })
        .set('Authorization', `Bearer ${storeRToken}`);
      const batchAReminders = remindersRes.body.reminders.filter((r) => r.batchId === batchA.body.batch.id);
      expect(batchAReminders).toHaveLength(2);

      // Handle 2 of 4 reminders (handleRate 0.5); 1 of 2 batches gets a
      // discarded unit (wasteRate 0.5, waste-report口径: distinct batches).
      const discard = await request(app)
        .post(`/api/store/reminders/${batchAReminders[0].id}/handle`)
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ reason: 'discarded' });
      expect(discard.status).toBe(200);
      const sold = await request(app)
        .post(`/api/store/reminders/${batchAReminders[1].id}/handle`)
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ reason: 'sold' });
      expect(sold.status).toBe(200);

      // Perfect-score self-check -> avgInspectionScore 100, no auto issues.
      const templateRes = await request(app)
        .post('/api/admin/inspection/templates')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ brandId: brandAId, name: 'P2 Rank Template' });
      expect(templateRes.status).toBe(201);
      const itemRes = await request(app)
        .post(`/api/admin/inspection/templates/${templateRes.body.template.id}/items`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: 'Cleanliness', maxScore: 10 });
      expect(itemRes.status).toBe(201);
      const startRes = await request(app)
        .post('/api/store/inspection/self-check/start')
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ templateId: templateRes.body.template.id });
      expect(startRes.status).toBe(201);
      const submitRes = await request(app)
        .post(`/api/store/inspection/self-check/${startRes.body.id}/submit`)
        .set('Authorization', `Bearer ${storeRToken}`)
        .send({ results: [{ checkItemId: itemRes.body.item.id, score: 10 }] });
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.pct).toBe(100);

      // One open + overdue issue at the ranking store.
      const issueRes = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          storeId: storeRId,
          title: 'Rank overdue issue',
          severity: 'high',
          assignee: 'Alice',
          dueDate: '2000-01-01T00:00:00.000Z'
        });
      expect(issueRes.status).toBe(201);
    });

    test('store-ranking aggregates handleRate/wasteRate/avgInspectionScore/issues per store', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/store-ranking')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      const row = res.body.items.find((item) => item.storeId === storeRId);
      expect(row).toEqual({
        storeId: storeRId,
        storeName: 'P2 Ranking Store',
        handleRate: 0.5,
        wasteRate: 0.5,
        avgInspectionScore: 100,
        openIssues: 1,
        overdueIssues: 1
      });

      const emptyRow = res.body.items.find((item) => item.storeId === storeEmptyId);
      expect(emptyRow).toMatchObject({
        handleRate: 0,
        wasteRate: 0,
        avgInspectionScore: null,
        openIssues: 0,
        overdueIssues: 0
      });
    });

    test('store-ranking from/to window excludes out-of-range activity', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/store-ranking')
        .query({ from: '2099-01-01' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      const row = res.body.items.find((item) => item.storeId === storeRId);
      expect(row.handleRate).toBe(0);
      expect(row.wasteRate).toBe(0);
      expect(row.avgInspectionScore).toBeNull();
    });

    test('brand admin store-ranking is auto-narrowed to its own brand', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/store-ranking')
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.items.find((item) => item.storeId === storeRId)).toBeUndefined();
    });

    test('summary accepts storeId/from/to/brandId drilldown params', async () => {
      const baseline = await request(app)
        .get('/api/admin/dashboard/summary')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(baseline.status).toBe(200);
      expect(baseline.body.summary.stores).toBeGreaterThan(1);

      const narrowed = await request(app)
        .get('/api/admin/dashboard/summary')
        .query({ storeId: storeEmptyId, brandId: brandAId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(narrowed.status).toBe(200);
      expect(narrowed.body.summary.stores).toBe(1);
      expect(narrowed.body.summary.todayExpiringCount).toBe(0);
      expect(narrowed.body.summary.unhandledExpiredCount).toBe(0);

      const windowed = await request(app)
        .get('/api/admin/dashboard/summary')
        .query({ from: '2099-01-01', to: '2099-12-31' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(windowed.status).toBe(200);
      expect(windowed.body.summary.handledRate).toBe(0);
    });

    test('ranking and trends accept from/to/storeId drilldown params', async () => {
      const ranking = await request(app)
        .get('/api/admin/dashboard/ranking')
        .query({ from: '2099-01-01', to: '2099-12-31' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(ranking.status).toBe(200);
      for (const row of ranking.body.ranking) {
        expect(row.count).toBe(0);
      }

      const lossTrend = await request(app)
        .get('/api/admin/dashboard/loss-trend')
        .query({ from: '2099-01-01' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(lossTrend.status).toBe(200);
      expect(lossTrend.body.trend).toEqual([]);

      const scoreTrend = await request(app)
        .get('/api/admin/dashboard/score-trend')
        .query({ storeId: storeRId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(scoreTrend.status).toBe(200);
      expect(scoreTrend.body.trend.length).toBeGreaterThan(0);
      expect(scoreTrend.body.trend[0].avgScore).toBe(100);
    });
  });

  describe('P2-4: issue closure loop', () => {
    let issueId;

    async function patchIssue(id, body) {
      return request(app)
        .patch(`/api/admin/inspection/issues/${id}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send(body);
    }

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          storeId: store1Id,
          title: 'Broken fridge seal',
          severity: 'high',
          assignee: 'Bob',
          dueDate: '2000-06-01T00:00:00.000Z'
        });
      expect(res.status).toBe(201);
      issueId = res.body.issue.id;
      expect(res.body.issue.status).toBe('pending');
      expect(res.body.issue.assignee).toBe('Bob');
      expect(res.body.issue.due_date).toBe('2000-06-01T00:00:00.000Z');
    });

    test('overdue=true filter returns the issue with a computed overdue flag', async () => {
      const res = await request(app)
        .get('/api/admin/inspection/issues')
        .query({ overdue: 'true' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      const issue = res.body.issues.find((i) => i.id === issueId);
      expect(issue).toBeDefined();
      expect(issue.overdue).toBe(true);
    });

    test("'open' is accepted as an alias for the stored 'pending' status (no-op)", async () => {
      const res = await patchIssue(issueId, { status: 'open' });
      expect(res.status).toBe(200);
      expect(res.body.issue.status).toBe('pending');
    });

    test('patch updates assignee and dueDate; future dueDate clears overdue', async () => {
      const res = await patchIssue(issueId, {
        assignee: 'Carol',
        dueDate: '2099-01-01T00:00:00.000Z'
      });
      expect(res.status).toBe(200);
      expect(res.body.issue.assignee).toBe('Carol');
      expect(res.body.issue.due_date).toBe('2099-01-01T00:00:00.000Z');

      const listRes = await request(app)
        .get('/api/admin/inspection/issues')
        .query({ storeId: store1Id })
        .set('Authorization', `Bearer ${platformToken}`);
      const issue = listRes.body.issues.find((i) => i.id === issueId);
      expect(issue.overdue).toBe(false);
    });

    test('invalid dueDate and unknown status are 400', async () => {
      const badDate = await patchIssue(issueId, { dueDate: 'not-a-date' });
      expect(badDate.status).toBe(400);
      const badStatus = await patchIssue(issueId, { status: 'weird' });
      expect(badStatus.status).toBe(400);
    });

    test('forward transitions succeed; backward transitions are 400', async () => {
      const toProgress = await patchIssue(issueId, { status: 'in_progress' });
      expect(toProgress.status).toBe(200);
      expect(toProgress.body.issue.status).toBe('in_progress');

      const backward = await patchIssue(issueId, { status: 'open' });
      expect(backward.status).toBe(400);
      expect(backward.body.error).toContain('illegal status transition');

      const toResolved = await patchIssue(issueId, { status: 'resolved' });
      expect(toResolved.status).toBe(200);

      const toClosed = await patchIssue(issueId, { status: 'closed' });
      expect(toClosed.status).toBe(200);

      const reopen = await patchIssue(issueId, { status: 'in_progress' });
      expect(reopen.status).toBe(400);
    });

    test('resolved/closed issues are never overdue', async () => {
      // Give the closed issue a past due date directly is impossible via the
      // flow, so create a fresh issue and resolve it.
      const createRes = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          storeId: store1Id,
          title: 'Past due but resolved',
          dueDate: '2000-01-01T00:00:00.000Z'
        });
      const id = createRes.body.issue.id;
      const resolveRes = await patchIssue(id, { status: 'resolved' });
      expect(resolveRes.status).toBe(200);

      const res = await request(app)
        .get('/api/admin/inspection/issues')
        .query({ overdue: 'true' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.body.issues.find((i) => i.id === id)).toBeUndefined();
    });

    test('patching a missing issue is 404 and status changes are audited', async () => {
      const missing = await patchIssue(999999, { status: 'closed' });
      expect(missing.status).toBe(404);

      const auditRes = await request(app)
        .get('/api/admin/audit-logs')
        .query({ action: 'issue.update' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(auditRes.status).toBe(200);
      const entry = auditRes.body.logs.find(
        (log) => log.targetId === String(issueId) && log.detail.includes('status=closed')
      );
      expect(entry).toBeDefined();
    });
  });
});

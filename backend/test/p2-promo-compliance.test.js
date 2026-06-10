/**
 * p2-promo-compliance.test.js
 * Covers:
 * - P2-3: brand promo rules (GET/PUT /api/admin/brands/:id/promo-rules,
 *   validation, audit), promo field on /api/store/reminders (tier hit by
 *   remaining time, tightest tier wins, expired falls into tightest tier),
 *   and the new 'discounted' handle action (handling_logs + waste byReason).
 * - P2-1: compliance reports (daily/weekly/monthly), including empty stores,
 *   risk entries, rectification rate, brand-admin narrowing and validation.
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

const JWT_SECRET = 'test-secret';
const HOUR_MS = 60 * 60 * 1000;

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function findItem(report, sectionTitle, label) {
  const section = report.sections.find((s) => s.title === sectionTitle);
  expect(section).toBeDefined();
  const item = section.items.find((i) => i.label === label);
  expect(item).toBeDefined();
  return item;
}

describe('P2: promo rules + compliance reports', () => {
  let db;
  let app;
  let platformToken;
  let brandPId;
  let brandBId;
  let brandBAdminToken;
  let storePId;
  let storePToken;
  let promoProductId;

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

  async function createStoreApi(brandId, name) {
    const res = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId, name });
    expect(res.status).toBe(201);
    return res.body.store.id;
  }

  async function printBatch(storeToken, productId, { quantity = 1, printedAt } = {}) {
    const res = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ productId, quantity, printedAt });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function listReminders(storeToken, status = 'all') {
    const res = await request(app)
      .get('/api/store/reminders')
      .query({ status })
      .set('Authorization', `Bearer ${storeToken}`);
    expect(res.status).toBe(200);
    return res.body.reminders;
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

    const brandP = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Promo Brand' });
    brandPId = brandP.body.brand.id;
    const brandB = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Other Brand' });
    brandBId = brandB.body.brand.id;

    storePId = await createStoreApi(brandPId, 'Promo Store');
    storePToken = await bindStore(storePId, 'promo-device-1');

    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        brandId: brandPId,
        name: 'Promo Milk',
        sku: 'PROMO-1',
        shelfLifeDays: 2,
        labelLanguage: 'single',
        costPrice: 5
      });
    expect(productRes.status).toBe(201);
    promoProductId = productRes.body.product.id;

    await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        email: 'promo-brandb@x.local',
        password: 'BrandBPassword123!',
        role: 'brand_admin',
        brandId: brandBId
      });
    const brandBLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'promo-brandb@x.local', password: 'BrandBPassword123!' });
    brandBAdminToken = brandBLogin.body.token;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe('P2-3: promo rules config', () => {
    test('reminders carry promo=null before any rules exist', async () => {
      await printBatch(storePToken, promoProductId, { printedAt: hoursAgoIso(47) });
      const reminders = await listReminders(storePToken);
      expect(reminders.length).toBeGreaterThan(0);
      for (const reminder of reminders) {
        expect(reminder.promo).toBeNull();
      }
    });

    test('PUT stores rules sorted by hoursBeforeExpiry descending and audits', async () => {
      const res = await request(app)
        .put(`/api/admin/brands/${brandPId}/promo-rules`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          rules: [
            { hoursBeforeExpiry: 6, action: 'remove' },
            { hoursBeforeExpiry: 24, action: 'discount', discountPercent: 30 }
          ]
        });
      expect(res.status).toBe(200);
      expect(res.body.rules).toEqual([
        { hoursBeforeExpiry: 24, action: 'discount', discountPercent: 30 },
        { hoursBeforeExpiry: 6, action: 'remove' }
      ]);

      const getRes = await request(app)
        .get(`/api/admin/brands/${brandPId}/promo-rules`)
        .set('Authorization', `Bearer ${platformToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ brandId: brandPId, rules: res.body.rules });

      const auditRes = await request(app)
        .get('/api/admin/audit-logs')
        .query({ action: 'brand.promo-rules.update' })
        .set('Authorization', `Bearer ${platformToken}`);
      const entry = auditRes.body.logs.find((log) => log.targetId === String(brandPId));
      expect(entry).toBeDefined();
      expect(entry.detail).toContain('discount');
    });

    test('PUT validates rules (400 on bad shape)', async () => {
      const cases = [
        {},
        { rules: 'nope' },
        { rules: [{ hoursBeforeExpiry: 0, action: 'remove' }] },
        { rules: [{ hoursBeforeExpiry: 4, action: 'banana' }] },
        { rules: [{ hoursBeforeExpiry: 4, action: 'discount' }] },
        { rules: [{ hoursBeforeExpiry: 4, action: 'discount', discountPercent: 150 }] },
        { rules: [{ hoursBeforeExpiry: 4, action: 'remove', discountPercent: 10 }] },
        {
          rules: [
            { hoursBeforeExpiry: 4, action: 'remove' },
            { hoursBeforeExpiry: 4, action: 'discount', discountPercent: 10 }
          ]
        }
      ];
      for (const body of cases) {
        const res = await request(app)
          .put(`/api/admin/brands/${brandPId}/promo-rules`)
          .set('Authorization', `Bearer ${platformToken}`)
          .send(body);
        expect(res.status).toBe(400);
      }
    });

    test('brand admin cannot read or write another brand promo rules (403)', async () => {
      const getRes = await request(app)
        .get(`/api/admin/brands/${brandPId}/promo-rules`)
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      expect(getRes.status).toBe(403);
      const putRes = await request(app)
        .put(`/api/admin/brands/${brandPId}/promo-rules`)
        .set('Authorization', `Bearer ${brandBAdminToken}`)
        .send({ rules: [] });
      expect(putRes.status).toBe(403);
    });

    test('unknown brand is 404', async () => {
      const res = await request(app)
        .get('/api/admin/brands/999999/promo-rules')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('P2-3: promo computation on store reminders', () => {
    let removeBatchId;
    let discountBatchId;
    let freshBatchId;
    let expiredBatchId;

    beforeAll(async () => {
      // Rules (from the previous block): discount@24h, remove@6h.
      // Remaining ~1h -> remove; ~12h -> discount; ~47h -> none; expired -> remove.
      discountBatchId = (await printBatch(storePToken, promoProductId, { printedAt: hoursAgoIso(36) })).batch.id;
      freshBatchId = (await printBatch(storePToken, promoProductId, { printedAt: hoursAgoIso(1) })).batch.id;
      expiredBatchId = (await printBatch(storePToken, promoProductId, { printedAt: hoursAgoIso(50) })).batch.id;
      // The batch printed at -47h in the config block is the ~1h-left one.
      const reminders = await listReminders(storePToken);
      removeBatchId = reminders.find((r) => ![discountBatchId, freshBatchId, expiredBatchId].includes(r.batchId)).batchId;
    });

    test('each reminder hits the tightest covering tier (or null)', async () => {
      const reminders = await listReminders(storePToken);
      const byBatch = (batchId) => reminders.find((r) => r.batchId === batchId);

      expect(byBatch(removeBatchId).promo).toEqual({ action: 'remove', hoursBeforeExpiry: 6 });
      expect(byBatch(discountBatchId).promo).toEqual({
        action: 'discount',
        hoursBeforeExpiry: 24,
        discountPercent: 30
      });
      expect(byBatch(freshBatchId).promo).toBeNull();
    });

    test('expired reminders fall into the tightest tier', async () => {
      const expired = await listReminders(storePToken, 'expired');
      const reminder = expired.find((r) => r.batchId === expiredBatchId);
      expect(reminder).toBeDefined();
      expect(reminder.promo).toEqual({ action: 'remove', hoursBeforeExpiry: 6 });
    });

    test("handle accepts 'discounted' and waste byReason includes it", async () => {
      const reminders = await listReminders(storePToken);
      const target = reminders.find((r) => r.batchId === discountBatchId);
      const handleRes = await request(app)
        .post(`/api/store/reminders/${target.id}/handle`)
        .set('Authorization', `Bearer ${storePToken}`)
        .send({ reason: 'discounted', note: '7折促销售出' });
      expect(handleRes.status).toBe(200);
      expect(handleRes.body.reminder.status).toBe('handled');

      const again = await request(app)
        .post(`/api/store/reminders/${target.id}/handle`)
        .set('Authorization', `Bearer ${storePToken}`)
        .send({ reason: 'discounted' });
      expect(again.status).toBe(409);

      const wasteRes = await request(app)
        .get('/api/admin/reports/waste')
        .query({ brandId: brandPId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(wasteRes.status).toBe(200);
      expect(wasteRes.body.byReason).toContainEqual({ reason: 'discounted', count: 1 });
    });

    test('unknown handle reason is 400 and mentions discounted', async () => {
      const reminders = await listReminders(storePToken);
      const res = await request(app)
        .post(`/api/store/reminders/${reminders[0].id}/handle`)
        .set('Authorization', `Bearer ${storePToken}`)
        .send({ reason: 'promo' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('discounted');
    });
  });

  describe('P2-1: compliance reports', () => {
    let brandCId;
    let storeCId;
    let storeCEmptyId;
    let storeMId;
    let storeCToken;
    let storeMToken;
    let complianceProductId;
    let rateDate;

    beforeAll(async () => {
      const brandC = await request(app)
        .post('/api/admin/brands')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: 'Compliance Brand' });
      brandCId = brandC.body.brand.id;
      storeCId = await createStoreApi(brandCId, 'Compliance Store');
      storeCEmptyId = await createStoreApi(brandCId, 'Compliance Empty Store');
      storeMId = await createStoreApi(brandCId, 'Compliance Monthly Store');
      storeCToken = await bindStore(storeCId, 'comp-device-1');
      storeMToken = await bindStore(storeMId, 'comp-device-m');

      const productRes = await request(app)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          brandId: brandCId,
          name: 'Compliance Bread',
          sku: 'COMP-1',
          shelfLifeDays: 1,
          labelLanguage: 'single'
        });
      complianceProductId = productRes.body.product.id;

      // Two units expiring in ~1h; handle one -> 50% handle rate on rateDate.
      const rateBatch = await printBatch(storeCToken, complianceProductId, {
        quantity: 2,
        printedAt: hoursAgoIso(23)
      });
      rateDate = rateBatch.batch.expiresAt.slice(0, 10);
      const reminders = await listReminders(storeCToken);
      const rateReminders = reminders.filter((r) => r.batchId === rateBatch.batch.id);
      const handleRes = await request(app)
        .post(`/api/store/reminders/${rateReminders[0].id}/handle`)
        .set('Authorization', `Bearer ${storeCToken}`)
        .send({ reason: 'sold' });
      expect(handleRes.status).toBe(200);

      // One long-expired unhandled batch (outside the daily window, but
      // cumulative "过期未处理" counts it).
      await printBatch(storeCToken, complianceProductId, { printedAt: hoursAgoIso(30 * 24) });

      // A completed self-check today (score 80%).
      const templateRes = await request(app)
        .post('/api/admin/inspection/templates')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ brandId: brandCId, name: 'Compliance Template' });
      const itemRes = await request(app)
        .post(`/api/admin/inspection/templates/${templateRes.body.template.id}/items`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: '清洁卫生', maxScore: 10 });
      const startRes = await request(app)
        .post('/api/store/inspection/self-check/start')
        .set('Authorization', `Bearer ${storeCToken}`)
        .send({ templateId: templateRes.body.template.id });
      const submitRes = await request(app)
        .post(`/api/store/inspection/self-check/${startRes.body.id}/submit`)
        .set('Authorization', `Bearer ${storeCToken}`)
        .send({ results: [{ checkItemId: itemRes.body.item.id, score: 8 }] });
      expect(submitRes.status).toBe(200);

      // Overdue rectification issue for weekly risks.
      const issueRes = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          storeId: storeCId,
          title: '冷柜温度超标',
          severity: 'high',
          assignee: '张三',
          dueDate: '2000-01-01T00:00:00.000Z'
        });
      expect(issueRes.status).toBe(201);
    });

    test('daily report aggregates handle rate / expired backlog for a store', async () => {
      const res = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ date: rateDate, storeId: storeCId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('daily');
      expect(res.body.date).toBe(rateDate);
      expect(res.body.store).toEqual({ id: storeCId, name: 'Compliance Store' });
      expect(res.body.brand).toEqual({ id: brandCId, name: 'Compliance Brand' });
      expect(res.body.generatedAt).toBeDefined();

      const rateItem = findItem(res.body, '效期与临期食品处理', '临期食品处理率');
      expect(rateItem.value).toBe('50.0%');
      expect(rateItem.status).toBe('warning');

      const expiredItem = findItem(res.body, '效期与临期食品处理', '过期未处理批次');
      expect(expiredItem.value).toBe(1);
      expect(expiredItem.status).toBe('fail');

      const expiredRisk = res.body.risks.find((r) => r.description.includes('过期批次未处理'));
      expect(expiredRisk).toBeDefined();
      expect(expiredRisk.severity).toBe('high');
      expect(expiredRisk.description).toContain('Compliance Bread');
    });

    test('daily report (default today) counts inspections and printed batches', async () => {
      const res = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ storeId: storeCId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);

      const inspectionItem = findItem(res.body, '日管控·食品安全检查', '巡检完成情况');
      expect(inspectionItem.value).toBe('1 次');
      expect(inspectionItem.status).toBe('ok');

      const scoreItem = findItem(res.body, '日管控·食品安全检查', '巡检平均得分');
      expect(scoreItem.value).toBe(80);
      expect(scoreItem.status).toBe('warning');

      const pinItem = findItem(res.body, '人员与系统安全', '员工 PIN 异常锁定');
      expect(pinItem.value).toBe('0 次');
      expect(pinItem.status).toBe('ok');
    });

    test('daily report for an empty store renders zeros/无 without error', async () => {
      const res = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ storeId: storeCEmptyId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.store.name).toBe('Compliance Empty Store');

      expect(findItem(res.body, '日管控·食品安全检查', '巡检完成情况').value).toBe('0 次');
      expect(findItem(res.body, '日管控·食品安全检查', '巡检平均得分').value).toBe('无');
      expect(findItem(res.body, '效期与临期食品处理', '打印批次数').value).toBe(0);
      expect(findItem(res.body, '效期与临期食品处理', '临期食品处理率').value).toBe('无');
      expect(findItem(res.body, '效期与临期食品处理', '过期未处理批次').value).toBe(0);

      const noInspectionRisk = res.body.risks.find((r) => r.description.includes('未完成任何食品安全巡检'));
      expect(noInspectionRisk).toBeDefined();
    });

    test('weekly report adds the rectification section and overdue-issue risks', async () => {
      const res = await request(app)
        .get('/api/admin/compliance/weekly')
        .query({ storeId: storeCId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('weekly');
      expect(res.body.weekStart).toBeDefined();
      expect(res.body.weekEnd).toBeDefined();

      expect(findItem(res.body, '风险隐患排查治理', '新增问题数').value).toBe(1);
      expect(findItem(res.body, '风险隐患排查治理', '逾期未整改问题数').value).toBe(1);

      const overdueRisk = res.body.risks.find((r) => r.description.includes('整改逾期：冷柜温度超标'));
      expect(overdueRisk).toBeDefined();
      expect(overdueRisk.severity).toBe('high');
      expect(overdueRisk.suggestion).toContain('整改');
    });

    test('monthly report computes the rectification completion rate', async () => {
      // Two issues at the monthly store; resolve one -> 50%.
      const issueA = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ storeId: storeMId, title: '地面积水' });
      const issueB = await request(app)
        .post('/api/admin/inspection/issues')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ storeId: storeMId, title: '灭蝇灯失效' });
      expect(issueA.status).toBe(201);
      expect(issueB.status).toBe(201);
      const resolveRes = await request(app)
        .patch(`/api/admin/inspection/issues/${issueA.body.issue.id}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ status: 'resolved' });
      expect(resolveRes.status).toBe(200);

      const month = new Date().toISOString().slice(0, 7);
      const res = await request(app)
        .get('/api/admin/compliance/monthly')
        .query({ month, storeId: storeMId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('monthly');
      expect(res.body.month).toBe(month);

      expect(findItem(res.body, '月度调度与整改', '整改完成率').value).toBe('50.0%');
      // Narrowed to one store: no cross-store risk ranking.
      expect(findItem(res.body, '月度调度与整改', 'Top 风险门店').value).toBe('无');
    });

    test('monthly report flags top risk stores at brand level', async () => {
      const month = new Date().toISOString().slice(0, 7);
      const res = await request(app)
        .get('/api/admin/compliance/monthly')
        .query({ month, brandId: brandCId })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res.status).toBe(200);
      const topItem = findItem(res.body, '月度调度与整改', 'Top 风险门店');
      expect(topItem.status).toBe('warning');
      expect(topItem.value).toContain('Compliance Store');
    });

    test('brand admin is auto-narrowed and cannot read another brand store', async () => {
      const own = await request(app)
        .get('/api/admin/compliance/daily')
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      expect(own.status).toBe(200);
      expect(own.body.brand).toEqual({ id: brandBId, name: 'Other Brand' });

      const foreign = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ storeId: storeCId })
        .set('Authorization', `Bearer ${brandBAdminToken}`);
      expect(foreign.status).toBe(403);
    });

    test('invalid period params are 400; unknown store is 404', async () => {
      const badDate = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ date: '2026-13-99' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(badDate.status).toBe(400);

      const badWeek = await request(app)
        .get('/api/admin/compliance/weekly')
        .query({ weekStart: 'last week' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(badWeek.status).toBe(400);

      const badMonth = await request(app)
        .get('/api/admin/compliance/monthly')
        .query({ month: '2026-1' })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(badMonth.status).toBe(400);

      const missingStore = await request(app)
        .get('/api/admin/compliance/daily')
        .query({ storeId: 999999 })
        .set('Authorization', `Bearer ${platformToken}`);
      expect(missingStore.status).toBe(404);
    });
  });
});

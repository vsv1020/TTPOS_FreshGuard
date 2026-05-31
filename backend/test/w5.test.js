/**
 * w5.test.js
 * Covers:
 *   A) Store staff (PIN attribution): admin creates staff, store lists/verifies, print with staffId
 *   B) Dashboard aggregation: summary, ranking, loss-trend, score-trend
 *   C) Label templates: create+set-default, preview, print uses template, fallback for no-template brand
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('w5: Staff / Dashboard / Label-template', () => {
  let db;
  let app;
  let adminToken;
  let seq = 1;

  // Shared brand A (has label template) — used for staff + dashboard + template tests
  let brandAId;
  let storeAId;
  let storeAToken;

  // Brand B — no label template, used for regression test
  let brandBId;
  let storeBId;
  let storeBToken;
  let productBId;

  function next(prefix) {
    return `${prefix}-w5-${seq++}`;
  }

  async function bindStore(storeId) {
    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ storeId, expiresInHours: 24 });
    expect(codeRes.statusCode).toBe(201);

    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: `dev-${storeId}` });
    expect(bindRes.statusCode).toBe(200);
    return bindRes.body.token;
  }

  beforeAll(async () => {
    db = await createDb(':memory:');
    await ensureAdminUser(db, { email: 'admin@w5.local', password: 'StrongPass1!' });
    app = buildApp({ db, jwtSecret: 'w5-secret', adminWebDir: `${__dirname}/../admin-web` });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@w5.local', password: 'StrongPass1!' });
    adminToken = login.body.token;

    // ── Brand A + Store A
    const bA = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: next('BrandA') });
    expect(bA.statusCode).toBe(201);
    brandAId = bA.body.brand.id;

    const sA = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId: brandAId, name: next('StoreA') });
    expect(sA.statusCode).toBe(201);
    storeAId = sA.body.store.id;
    storeAToken = await bindStore(storeAId);

    // Create a product for Brand A (used in dashboard + template tests)
    const pA = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: brandAId,
        name: next('ProdA'),
        sku: next('SKU'),
        shelfLifeDays: 3,
        labelLanguage: 'single',
        primaryLanguage: 'en'
      });
    expect(pA.statusCode).toBe(201);
    // productAId is used below in template tests
    this.productAId = pA.body.product.id;

    // ── Brand B + Store B (no label template — regression brand)
    const bB = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: next('BrandB') });
    expect(bB.statusCode).toBe(201);
    brandBId = bB.body.brand.id;

    const sB = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId: brandBId, name: next('StoreB') });
    expect(sB.statusCode).toBe(201);
    storeBId = sB.body.store.id;
    storeBToken = await bindStore(storeBId);

    const pB = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: brandBId,
        name: next('ProdB'),
        sku: next('SKU'),
        shelfLifeDays: 3,
        labelLanguage: 'single',
        primaryLanguage: 'en'
      });
    expect(pB.statusCode).toBe(201);
    productBId = pB.body.product.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  // ─── A: Store Staff (PIN attribution) ────────────────────────────────────────

  describe('A: Store Staff', () => {
    let staffId;
    let productAId;

    beforeAll(async () => {
      // Create a product for Brand A for print tests
      const pA = await request(app)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          brandId: brandAId,
          name: next('StaffProd'),
          sku: next('SKU'),
          shelfLifeDays: 3,
          labelLanguage: 'single',
          primaryLanguage: 'en'
        });
      expect(pA.statusCode).toBe(201);
      productAId = pA.body.product.id;
    });

    test('admin creates staff with PIN for Store A', async () => {
      const res = await request(app)
        .post(`/api/admin/stores/${storeAId}/staff`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Alice', pin: '1234', role: 'staff' });
      expect(res.statusCode).toBe(201);
      expect(res.body.staff).toMatchObject({ name: 'Alice', role: 'staff', isActive: 1 });
      staffId = res.body.staff.id;
    });

    test('store GET /api/store/staff lists the created staff member', async () => {
      const res = await request(app)
        .get('/api/store/staff')
        .set('Authorization', `Bearer ${storeAToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.staff).toBeInstanceOf(Array);
      const found = res.body.staff.find((s) => s.id === staffId);
      expect(found).toBeTruthy();
      expect(found.name).toBe('Alice');
    });

    test('verify-pin returns valid=true for correct PIN', async () => {
      const res = await request(app)
        .post(`/api/store/staff/${staffId}/verify-pin`)
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({ pin: '1234' });
      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    test('verify-pin returns valid=false for wrong PIN', async () => {
      const res = await request(app)
        .post(`/api/store/staff/${staffId}/verify-pin`)
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({ pin: '0000' });
      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(false);
    });

    test('print with staffId succeeds and audit log references the staff', async () => {
      const printRes = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({
          productId: productAId,
          quantity: 1,
          printedAt: new Date().toISOString(),
          staffId
        });
      expect(printRes.statusCode).toBe(201);
      expect(printRes.body.batch).toBeTruthy();

      // Audit log should contain a print entry whose detail mentions the staffId
      const auditRes = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditRes.statusCode).toBe(200);
      const printLog = auditRes.body.logs.find(
        (l) =>
          l.action === 'print' &&
          l.targetId === String(printRes.body.batch.id)
      );
      expect(printLog).toBeTruthy();
      // actorId is set to the staffId string when staffId is provided
      expect(printLog.actorId).toBe(String(staffId));
    });

    test('handle reminder with staffId is reflected in audit log', async () => {
      // Print a batch with a past date so it expires immediately
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const printRes = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({ productId: productAId, quantity: 1, printedAt: pastDate });
      expect(printRes.statusCode).toBe(201);

      const remindersRes = await request(app)
        .get('/api/store/reminders?status=expired')
        .set('Authorization', `Bearer ${storeAToken}`);
      expect(remindersRes.statusCode).toBe(200);
      const reminder = remindersRes.body.reminders.find(
        (r) => r.batchId === printRes.body.batch.id
      );
      expect(reminder).toBeTruthy();

      const handleRes = await request(app)
        .post(`/api/store/reminders/${reminder.id}/handle`)
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({ reason: 'discarded', staffId });
      expect(handleRes.statusCode).toBe(200);

      // Audit log should record actorId = staffId
      const auditRes = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      const handleLog = auditRes.body.logs.find(
        (l) => l.action === 'reminder.handle' && l.targetId === String(reminder.id)
      );
      expect(handleLog).toBeTruthy();
      expect(handleLog.actorId).toBe(String(staffId));
    });
  });

  // ─── B: Dashboard aggregation ────────────────────────────────────────────────

  describe('B: Dashboard', () => {
    test('GET /api/admin/dashboard/summary returns required numeric fields', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      const s = res.body.summary;
      expect(s).toBeDefined();
      expect(typeof s.todayExpiringCount).toBe('number');
      expect(typeof s.unhandledExpiredCount).toBe('number');
      expect(typeof s.stores).toBe('number');
      expect(typeof s.products).toBe('number');
      expect(typeof s.brands).toBe('number');
      expect(typeof s.handledRate).toBe('number');
      // At least 2 stores exist (storeA + storeB)
      expect(s.stores).toBeGreaterThanOrEqual(2);
    });

    test('GET /api/admin/dashboard/ranking returns array with storeId/storeName/count', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/ranking')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.ranking).toBeInstanceOf(Array);
      if (res.body.ranking.length > 0) {
        const item = res.body.ranking[0];
        expect(typeof item.storeId).toBe('number');
        expect(typeof item.storeName).toBe('string');
        expect(typeof item.count).toBe('number');
      }
    });

    test('GET /api/admin/dashboard/loss-trend returns array with date/expired/handled', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/loss-trend')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.trend).toBeInstanceOf(Array);
      // Each row must have date, expired, handled if non-empty
      for (const row of res.body.trend) {
        expect(typeof row.date).toBe('string');
        expect(typeof row.expired).toBe('number');
        expect(typeof row.handled).toBe('number');
      }
    });

    test('GET /api/admin/dashboard/score-trend returns array with date/avgScore/count', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/score-trend')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.trend).toBeInstanceOf(Array);
      for (const row of res.body.trend) {
        expect(typeof row.date).toBe('string');
        expect(typeof row.count).toBe('number');
      }
    });
  });

  // ─── C: Label templates ───────────────────────────────────────────────────────

  describe('C: Label Templates', () => {
    let templateId;
    let productForTemplateId;

    beforeAll(async () => {
      const pA = await request(app)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          brandId: brandAId,
          name: next('TplProd'),
          sku: next('SKU'),
          shelfLifeDays: 5,
          labelLanguage: 'single',
          primaryLanguage: 'en',
          allergens: 'nuts'
        });
      expect(pA.statusCode).toBe(201);
      productForTemplateId = pA.body.product.id;
    });

    test('admin creates a label template with body_template and sets it as default', async () => {
      const res = await request(app)
        .post('/api/admin/label-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          brandId: brandAId,
          name: 'W5 Template',
          bodyTemplate: 'Product:{{product_name}} Exp:{{expires_at}} Allergens:{{allergens}} Barcode:{{barcode}}',
          isDefault: true
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.template).toMatchObject({
        name: 'W5 Template',
        isDefault: 1,
        brandId: brandAId
      });
      expect(res.body.template.bodyTemplate).toContain('{{product_name}}');
      templateId = res.body.template.id;
    });

    test('preview endpoint replaces {{placeholders}} correctly', async () => {
      const res = await request(app)
        .post(`/api/admin/label-templates/${templateId}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fields: {
            product_name: 'TestProduct',
            expires_at: '2099-12-31',
            allergens: 'gluten',
            barcode: 'FG-1-2-3'
          }
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.text).toBe(
        'Product:TestProduct Exp:2099-12-31 Allergens:gluten Barcode:FG-1-2-3'
      );
    });

    test('preview replaces missing placeholders with empty string', async () => {
      const res = await request(app)
        .post(`/api/admin/label-templates/${templateId}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fields: { product_name: 'OnlyName' }
        });
      expect(res.statusCode).toBe(200);
      // Missing placeholders become empty strings
      expect(res.body.text).toContain('Product:OnlyName');
      expect(res.body.text).toContain('Allergens:');
      expect(res.body.text).toContain('Barcode:');
    });

    test('print for Brand A uses the default template (label.text contains rendered output)', async () => {
      const printRes = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeAToken}`)
        .send({
          productId: productForTemplateId,
          quantity: 1,
          printedAt: new Date().toISOString()
        });
      expect(printRes.statusCode).toBe(201);

      const labelText = printRes.body.label.text;
      // The template renders via renderLabelFromTemplate, so "=== FreshGuard Label ===" header
      // should NOT appear; instead we should see the template's own format.
      expect(labelText).toContain('Product:');
      expect(labelText).toContain('Exp:');
      expect(labelText).toContain('Allergens:nuts');
      // barcodeData is substituted via {{barcode}}
      expect(labelText).toMatch(/Barcode:FG-\d+-\d+-\d+/);
      // templateBody field is populated
      expect(printRes.body.label.templateBody).toContain('{{product_name}}');
    });

    test('regression: Brand B (no default template) still uses the legacy label format', async () => {
      // Brand B has no label template; print should fall back to renderLabelTemplate
      const printRes = await request(app)
        .post('/api/store/print')
        .set('Authorization', `Bearer ${storeBToken}`)
        .send({
          productId: productBId,
          quantity: 1,
          printedAt: new Date().toISOString()
        });
      expect(printRes.statusCode).toBe(201);

      const labelText = printRes.body.label.text;
      // Legacy format header
      expect(labelText).toContain('=== FreshGuard Label ===');
      expect(labelText).toContain('Product:');
      // templateBody is null when no template exists
      expect(printRes.body.label.templateBody).toBeNull();
    });
  });
});

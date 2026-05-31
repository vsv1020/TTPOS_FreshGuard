/**
 * features.test.js
 * Covers: product CRUD, label compliance fields, PAO open, CSV export,
 * audit logs, and inspection auto-Issue generation.
 */
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('Feature coverage tests', () => {
  let db;
  let app;
  let adminToken;
  let sequence = 1;

  // Shared brand / store / storeToken reused across most tests
  let sharedBrandId;
  let sharedStoreId;
  let sharedStoreToken;

  // Shared inspection template + check item
  let templateId;
  let checkItemId;

  function nextName(prefix) {
    const value = `${prefix}-feat-${sequence}`;
    sequence += 1;
    return value;
  }

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

    // Login
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });
    adminToken = login.body.token;

    // Setup shared brand + store
    const brandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: nextName('Brand') });
    expect(brandRes.statusCode).toBe(201);
    sharedBrandId = brandRes.body.brand.id;

    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId: sharedBrandId, name: nextName('Store') });
    expect(storeRes.statusCode).toBe(201);
    sharedStoreId = storeRes.body.store.id;

    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ storeId: sharedStoreId, expiresInHours: 24 });
    expect(codeRes.statusCode).toBe(201);

    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: 'feat-device-01' });
    expect(bindRes.statusCode).toBe(200);
    sharedStoreToken = bindRes.body.token;

    // Setup inspection template + check item
    const tplRes = await request(app)
      .post('/api/admin/inspection/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId: sharedBrandId, name: 'Feature Check', totalScore: 20 });
    expect(tplRes.statusCode).toBe(201);
    templateId = tplRes.body.template.id;

    const itemRes = await request(app)
      .post(`/api/admin/inspection/templates/${templateId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cleanliness', maxScore: 20, sortOrder: 1 });
    expect(itemRes.statusCode).toBe(201);
    checkItemId = itemRes.body.item.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  // ─── Product PATCH / DELETE ──────────────────────────────

  test('PATCH product updates shelfLifeDays and allergens; re-fetch reflects changes', async () => {
    // Create product
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 5,
        labelLanguage: 'single',
        primaryLanguage: 'en'
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    // Patch shelfLifeDays + allergens
    const patchRes = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shelfLifeDays: 10, allergens: 'nuts, dairy' });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body.product.shelfLifeDays).toBe(10);
    expect(patchRes.body.product.allergens).toBe('nuts, dairy');

    // Re-fetch via list and confirm
    const listRes = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.statusCode).toBe(200);
    const found = listRes.body.products.find((p) => p.id === productId);
    expect(found).toBeTruthy();
    expect(found.shelfLifeDays).toBe(10);
    expect(found.allergens).toBe('nuts, dairy');
  });

  test('DELETE product soft-deletes; product no longer in listProducts', async () => {
    // Create a separate product to delete
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 3,
        labelLanguage: 'single',
        primaryLanguage: 'en'
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    // Soft-delete
    const delRes = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.statusCode).toBe(200);

    // listProducts should not return the deleted product
    const listRes = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.statusCode).toBe(200);
    const ids = listRes.body.products.map((p) => p.id);
    expect(ids).not.toContain(productId);
  });

  // ─── Label compliance fields + traceable barcode ─────────

  test('print label text contains allergens, storageConditions when set, and FG-... barcode', async () => {
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 7,
        labelLanguage: 'single',
        primaryLanguage: 'en',
        allergens: 'gluten, soy',
        storageConditions: 'Keep refrigerated 0-4°C',
        openedShelfLifeHours: 48
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ productId, quantity: 1, printedAt: new Date().toISOString() });
    expect(printRes.statusCode).toBe(201);

    const labelText = printRes.body.label.text;
    // allergens
    expect(labelText).toContain('gluten, soy');
    // storageConditions
    expect(labelText).toContain('Keep refrigerated 0-4°C');
    // traceable barcode format: FG-<brandId>-<storeId>-<batchId>
    expect(labelText).toMatch(/Barcode:\s*FG-\d+-\d+-\d+/);
    // barcodeData on batch itself starts with FG-
    expect(printRes.body.batch.barcodeData).toMatch(/^FG-/);
  });

  // ─── PAO (opened shelf life) ─────────────────────────────

  test('open reminder: product with openedShelfLifeHours returns new reminder with expires_at ~now+hours', async () => {
    // Create product with openedShelfLifeHours
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 14,
        labelLanguage: 'single',
        primaryLanguage: 'en',
        openedShelfLifeHours: 12
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    // Print to get a reminder
    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ productId, quantity: 1, printedAt: new Date().toISOString() });
    expect(printRes.statusCode).toBe(201);

    // Get a reminder id
    const remindersRes = await request(app)
      .get('/api/store/reminders?status=all')
      .set('Authorization', `Bearer ${sharedStoreToken}`);
    expect(remindersRes.statusCode).toBe(200);
    const reminder = remindersRes.body.reminders.find((r) => r.productId === productId);
    expect(reminder).toBeTruthy();

    const beforeOpen = Date.now();
    const openRes = await request(app)
      .post(`/api/store/reminders/${reminder.id}/open`)
      .set('Authorization', `Bearer ${sharedStoreToken}`);
    const afterOpen = Date.now();

    expect(openRes.statusCode).toBe(201);
    expect(openRes.body.reminder).toBeDefined();

    // expires_at should be approximately now + 12 hours
    const expiresAt = new Date(openRes.body.reminder.expiresAt).getTime();
    const expectedMin = beforeOpen + 12 * 60 * 60 * 1000;
    const expectedMax = afterOpen + 12 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 5000);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax + 5000);

    // note should be 'opened'
    expect(openRes.body.reminder.note).toBe('opened');
  });

  test('open reminder: product without openedShelfLifeHours returns 400', async () => {
    // Create product WITHOUT openedShelfLifeHours
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 5,
        labelLanguage: 'single',
        primaryLanguage: 'en'
        // no openedShelfLifeHours
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    // Print
    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ productId, quantity: 1, printedAt: new Date().toISOString() });
    expect(printRes.statusCode).toBe(201);

    // Get the reminder
    const remindersRes = await request(app)
      .get('/api/store/reminders?status=all')
      .set('Authorization', `Bearer ${sharedStoreToken}`);
    expect(remindersRes.statusCode).toBe(200);
    const reminder = remindersRes.body.reminders.find((r) => r.productId === productId);
    expect(reminder).toBeTruthy();

    // open should return 400
    const openRes = await request(app)
      .post(`/api/store/reminders/${reminder.id}/open`)
      .set('Authorization', `Bearer ${sharedStoreToken}`);
    expect(openRes.statusCode).toBe(400);
  });

  // ─── CSV export ──────────────────────────────────────────

  test('GET expired-handling?format=csv returns text/csv with header row', async () => {
    const csvRes = await request(app)
      .get('/api/admin/reports/expired-handling?format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    // First line should be the header
    const firstLine = csvRes.text.split('\n')[0];
    expect(firstLine).toContain('Store ID');
    expect(firstLine).toContain('Store Name');
    expect(firstLine).toContain('Product ID');
    expect(firstLine).toContain('Product Name');
  });

  // ─── Audit logs ──────────────────────────────────────────

  test('audit log contains login entry after admin login', async () => {
    // Fresh login to guarantee a new audit entry
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });

    const auditRes = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.statusCode).toBe(200);
    const loginLog = auditRes.body.logs.find((l) => l.action === 'login');
    expect(loginLog).toBeTruthy();
    expect(loginLog.actorType).toBe('admin');
  });

  test('audit log contains print entry after store prints a batch', async () => {
    // Create and print a product
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        brandId: sharedBrandId,
        name: nextName('Product'),
        sku: nextName('SKU'),
        shelfLifeDays: 3,
        labelLanguage: 'single',
        primaryLanguage: 'en'
      });
    expect(createRes.statusCode).toBe(201);
    const productId = createRes.body.product.id;

    const printRes = await request(app)
      .post('/api/store/print')
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ productId, quantity: 1, printedAt: new Date().toISOString() });
    expect(printRes.statusCode).toBe(201);
    const batchId = printRes.body.batch.id;

    // Check audit log for the print entry
    const auditRes = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.statusCode).toBe(200);
    const printLog = auditRes.body.logs.find(
      (l) => l.action === 'print' && l.targetId === String(batchId)
    );
    expect(printLog).toBeTruthy();
    expect(printLog.actorType).toBe('store');
  });

  // ─── Inspection auto-Issue generation ────────────────────

  test('submitting inspection with score=0 item auto-generates a critical issue', async () => {
    // Start a formal inspection
    const startRes = await request(app)
      .post('/api/store/inspection/start')
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ templateId, inspectorId: 1 });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.inspection.id;

    // Submit with score=0 on the check item (critical: score === 0)
    const submitRes = await request(app)
      .post(`/api/store/inspection/${inspId}/submit`)
      .set('Authorization', `Bearer ${sharedStoreToken}`)
      .send({ results: [{ checkItemId, score: 0 }] });
    expect(submitRes.statusCode).toBe(200);

    // Issues list should have an auto-generated critical issue for this inspection
    const issuesRes = await request(app)
      .get('/api/admin/inspection/issues')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(issuesRes.statusCode).toBe(200);
    const autoIssue = issuesRes.body.issues.find(
      (iss) => iss.inspection_id === inspId && iss.severity === 'critical'
    );
    expect(autoIssue).toBeTruthy();
    expect(autoIssue.title).toContain('Low score');
  });
});

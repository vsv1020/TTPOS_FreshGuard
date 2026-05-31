const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

describe('Inspection module', () => {
  let db;
  let app;
  let adminToken;
  let sequence = 1;

  // Store A
  let brandAId;
  let storeAId;
  let storeAToken;

  // Store B (for IDOR tests)
  let storeBId;
  let storeBToken;

  // Shared template + check items
  let templateId;
  let checkItemId;

  function nextName(prefix) {
    const value = `${prefix}-insp-${sequence}`;
    sequence += 1;
    return value;
  }

  async function bindStore(brandId) {
    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId, name: nextName('Store') });
    expect(storeRes.statusCode).toBe(201);
    const storeId = storeRes.body.store.id;

    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ storeId, expiresInHours: 24 });
    expect(codeRes.statusCode).toBe(201);
    const code = codeRes.body.bindingCode.code;

    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code, deviceId: `device-${storeId}` });
    expect(bindRes.statusCode).toBe(200);

    return { storeId, storeToken: bindRes.body.token };
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

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });
    adminToken = login.body.token;

    // Create brand A and bind store A
    const brandARes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: nextName('BrandA') });
    expect(brandARes.statusCode).toBe(201);
    brandAId = brandARes.body.brand.id;

    const storeA = await bindStore(brandAId);
    storeAId = storeA.storeId;
    storeAToken = storeA.storeToken;

    // Create brand B and bind store B (for IDOR tests)
    const brandBRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: nextName('BrandB') });
    expect(brandBRes.statusCode).toBe(201);
    const brandBId = brandBRes.body.brand.id;

    const storeB = await bindStore(brandBId);
    storeBId = storeB.storeId;
    storeBToken = storeB.storeToken;

    // Create a template + check item under brand A
    const tplRes = await request(app)
      .post('/api/admin/inspection/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ brandId: brandAId, name: 'Food Safety Check', totalScore: 100 });
    expect(tplRes.statusCode).toBe(201);
    templateId = tplRes.body.template.id;

    const itemRes = await request(app)
      .post(`/api/admin/inspection/templates/${templateId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temperature Check', maxScore: 20, sortOrder: 1 });
    expect(itemRes.statusCode).toBe(201);
    checkItemId = itemRes.body.item.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  // ─── Admin: Template CRUD ─────────────────────────────────

  test('admin can create inspection template and check item', () => {
    // Already done in beforeAll; just assert the values are valid
    expect(templateId).toBeGreaterThan(0);
    expect(checkItemId).toBeGreaterThan(0);
  });

  // ─── Store: Template list & detail ────────────────────────

  test('store can list templates for its brand', async () => {
    const res = await request(app)
      .get('/api/store/inspection/templates')
      .set('Authorization', `Bearer ${storeAToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    const found = res.body.templates.find(t => t.id === templateId);
    expect(found).toBeTruthy();
  });

  test('store can get template detail including checkItems', async () => {
    const res = await request(app)
      .get(`/api/store/inspection/templates/${templateId}`)
      .set('Authorization', `Bearer ${storeAToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.template).toBeDefined();
    expect(Array.isArray(res.body.template.checkItems)).toBe(true);
    expect(res.body.template.checkItems.length).toBeGreaterThan(0);
    expect(res.body.template.checkItems[0].id).toBe(checkItemId);
  });

  // ─── Self-check: start + submit ───────────────────────────

  test('self-check start succeeds (schema fix: no FK error on inspector_id)', async () => {
    const res = await request(app)
      .post('/api/store/inspection/self-check/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.type).toBe('self_check');
    expect(res.body.status).toBe('in_progress');
  });

  test('self-check submit returns grade and writes max_score/score_pct', async () => {
    // Start a new self-check
    const startRes = await request(app)
      .post('/api/store/inspection/self-check/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.id;

    // Submit with full score (20/20)
    const submitRes = await request(app)
      .post(`/api/store/inspection/self-check/${inspId}/submit`)
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({
        results: [{ checkItemId, score: 20 }]
      });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.body.grade).toBeDefined();
    // 20/20 = 100% => grade A
    expect(submitRes.body.grade).toBe('A');
    expect(submitRes.body.maxScore).toBe(20);
    expect(submitRes.body.totalScore).toBe(20);
    expect(submitRes.body.pct).toBe(100);
  });

  // ─── Score clamping ───────────────────────────────────────

  test('submitted score above max_score is clamped to max_score', async () => {
    const startRes = await request(app)
      .post('/api/store/inspection/self-check/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.id;

    // Submit with score 999, way above max_score of 20
    const submitRes = await request(app)
      .post(`/api/store/inspection/self-check/${inspId}/submit`)
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({
        results: [{ checkItemId, score: 999 }]
      });
    expect(submitRes.statusCode).toBe(200);
    // Clamped: totalScore should be 20, not 999
    expect(submitRes.body.totalScore).toBe(20);
    expect(submitRes.body.maxScore).toBe(20);
  });

  // ─── Formal inspection: start → submit → scorecard ────────

  test('formal inspection start→submit returns non-F grade', async () => {
    // Start formal inspection
    const startRes = await request(app)
      .post('/api/store/inspection/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId, inspectorId: 1 });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.inspection.id;

    // Submit with full score (20/20)
    const submitRes = await request(app)
      .post(`/api/store/inspection/${inspId}/submit`)
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({
        results: [{ checkItemId, score: 20 }]
      });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.body.inspection).toBeDefined();
    expect(submitRes.body.inspection.total_score).toBe(20);
    expect(submitRes.body.inspection.max_score).toBe(20);

    // Get scorecard via store endpoint
    const scorecardRes = await request(app)
      .get(`/api/store/inspection/${inspId}/scorecard`)
      .set('Authorization', `Bearer ${storeAToken}`);
    expect(scorecardRes.statusCode).toBe(200);
    expect(scorecardRes.body.grade).toBeDefined();
    // 20/20 = A, should not be F
    expect(scorecardRes.body.grade).not.toBe('F');
    expect(scorecardRes.body.grade).toBe('A');
  });

  // ─── IDOR: store B cannot access store A's inspection ─────

  test('IDOR: store B cannot access store A scorecard (403)', async () => {
    // Create a formal inspection for store A
    const startRes = await request(app)
      .post('/api/store/inspection/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId, inspectorId: 1 });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.inspection.id;

    // Submit it
    await request(app)
      .post(`/api/store/inspection/${inspId}/submit`)
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ results: [{ checkItemId, score: 15 }] });

    // Store B tries to access store A's scorecard
    const res = await request(app)
      .get(`/api/store/inspection/${inspId}/scorecard`)
      .set('Authorization', `Bearer ${storeBToken}`);
    expect(res.statusCode).toBe(403);
  });

  test('IDOR: store B cannot submit store A inspection (403)', async () => {
    // Create a formal inspection for store A
    const startRes = await request(app)
      .post('/api/store/inspection/start')
      .set('Authorization', `Bearer ${storeAToken}`)
      .send({ templateId, inspectorId: 1 });
    expect(startRes.statusCode).toBe(201);
    const inspId = startRes.body.inspection.id;

    // Store B tries to submit store A's inspection
    const res = await request(app)
      .post(`/api/store/inspection/${inspId}/submit`)
      .set('Authorization', `Bearer ${storeBToken}`)
      .send({ results: [{ checkItemId, score: 15 }] });
    expect(res.statusCode).toBe(403);
  });

  // ─── Route order: GET /api/admin/inspection/issues ────────

  test('GET /api/admin/inspection/issues returns array, not 404 (route order fix)', async () => {
    const res = await request(app)
      .get('/api/admin/inspection/issues')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });
});

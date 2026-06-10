/**
 * rbac-security.test.js
 * Covers:
 * - P1-1 RBAC: role migration (legacy 'admin' -> platform_admin/brand_admin),
 *   admins CRUD (platform_admin only), viewer read-only, login carries role,
 *   reset-password, disabled accounts, audit points.
 * - P1-7 security: store token_version revocation (legacy tokens count as
 *   version 0), verify-pin SQLite-persisted throttling (5 fails -> 15 min lock).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { buildApp } = require('../src/app');
const { closeDb, createDb, ensureAdminUser } = require('../src/db');

const JWT_SECRET = 'test-secret';

describe('RBAC role migration (createDb)', () => {
  test('legacy admin rows become platform_admin (no brand) or brand_admin', async () => {
    const file = path.join(os.tmpdir(), `fg-rbac-migration-${Date.now()}.sqlite`);
    const before = await createDb(file);
    await before.run("INSERT INTO brands (name) VALUES ('Mig Brand')");
    const brand = await before.get("SELECT id FROM brands WHERE name = 'Mig Brand'");
    await before.run(
      "INSERT INTO users (email, password_hash, role, brand_id) VALUES ('mig-platform@x.local', 'h', 'admin', NULL)"
    );
    await before.run(
      "INSERT INTO users (email, password_hash, role, brand_id) VALUES ('mig-brand@x.local', 'h', 'admin', ?)",
      brand.id
    );
    await closeDb(before);

    const after = await createDb(file);
    const platform = await after.get(
      "SELECT role, disabled FROM users WHERE email = 'mig-platform@x.local'"
    );
    const brandAdmin = await after.get(
      "SELECT role, disabled FROM users WHERE email = 'mig-brand@x.local'"
    );
    expect(platform.role).toBe('platform_admin');
    expect(platform.disabled).toBe(0);
    expect(brandAdmin.role).toBe('brand_admin');
    await closeDb(after);
    fs.unlinkSync(file);
  });
});

describe('RBAC admins CRUD + viewer read-only + token revocation + PIN throttle', () => {
  let db;
  let app;
  let platformToken;
  let brandId;
  let otherBrandId;
  let storeId;
  let storeToken;
  let staffId;
  let secondStaffId;
  let productId;

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

    const brandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'RBAC Brand' });
    brandId = brandRes.body.brand.id;
    const otherBrandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'RBAC Other Brand' });
    otherBrandId = otherBrandRes.body.brand.id;

    const storeRes = await request(app)
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId, name: 'RBAC Store' });
    storeId = storeRes.body.store.id;

    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ brandId, name: 'RBAC Milk', shelfLifeDays: 3, labelLanguage: 'single' });
    productId = productRes.body.product.id;

    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ storeId, expiresInHours: 24 });
    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: 'rbac-device-01' });
    storeToken = bindRes.body.token;

    const staffRes = await request(app)
      .post(`/api/admin/stores/${storeId}/staff`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Pin Tester', pin: '1234', role: 'staff' });
    staffId = staffRes.body.staff.id;
    const secondStaffRes = await request(app)
      .post(`/api/admin/stores/${storeId}/staff`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Pin Tester 2', pin: '5678', role: 'staff' });
    secondStaffId = secondStaffRes.body.staff.id;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  const loginAs = async (email, password) =>
    request(app).post('/api/auth/login').send({ email, password });

  test('seed admin logs in as platform_admin and /me carries role', async () => {
    const login = await loginAs('admin@freshguard.local', 'StrongPassword123!');
    expect(login.statusCode).toBe(200);
    expect(login.body.user.role).toBe('platform_admin');

    const me = await request(app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(me.statusCode).toBe(200);
    expect(me.body.role).toBe('platform_admin');
  });

  test('platform_admin creates brand_admin and viewer accounts (audited)', async () => {
    const brandAdminRes = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'rbac-brand@x.local', password: 'BrandPass123!', role: 'brand_admin', brandId });
    expect(brandAdminRes.statusCode).toBe(201);
    expect(brandAdminRes.body.admin).toMatchObject({
      email: 'rbac-brand@x.local',
      role: 'brand_admin',
      brandId,
      disabled: 0
    });

    const viewerRes = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'rbac-viewer@x.local', password: 'ViewerPass123!', role: 'viewer' });
    expect(viewerRes.statusCode).toBe(201);
    expect(viewerRes.body.admin.role).toBe('viewer');
    expect(viewerRes.body.admin.brandId).toBeNull();

    const audit = await request(app)
      .get('/api/admin/audit-logs')
      .query({ action: 'admin.create', limit: 10 })
      .set('Authorization', `Bearer ${platformToken}`);
    expect(audit.body.total).toBe(2);
  });

  test('admins CRUD validation: bad role, brand_admin without brandId, duplicate email', async () => {
    const badRole = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'bad@x.local', password: 'p', role: 'superuser' });
    expect(badRole.statusCode).toBe(400);

    const noBrand = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'bad2@x.local', password: 'p', role: 'brand_admin' });
    expect(noBrand.statusCode).toBe(400);

    const dup = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ email: 'rbac-viewer@x.local', password: 'p', role: 'viewer' });
    expect(dup.statusCode).toBe(400);
  });

  test('GET /api/admin/admins supports the pagination envelope', async () => {
    const legacy = await request(app)
      .get('/api/admin/admins')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(legacy.statusCode).toBe(200);
    expect(Array.isArray(legacy.body.admins)).toBe(true);

    const paged = await request(app)
      .get('/api/admin/admins')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${platformToken}`);
    expect(paged.statusCode).toBe(200);
    expect(paged.body.items.length).toBe(2);
    expect(paged.body.total).toBe(3); // seed platform admin + brand_admin + viewer
    expect(paged.body.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        email: expect.any(String),
        role: expect.any(String),
        disabled: expect.any(Number)
      })
    );
  });

  test('brand_admin cannot access admins management (403)', async () => {
    const login = await loginAs('rbac-brand@x.local', 'BrandPass123!');
    expect(login.statusCode).toBe(200);
    expect(login.body.user.role).toBe('brand_admin');

    const list = await request(app)
      .get('/api/admin/admins')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(list.statusCode).toBe(403);

    const create = await request(app)
      .post('/api/admin/admins')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ email: 'sneaky@x.local', password: 'p', role: 'viewer' });
    expect(create.statusCode).toBe(403);
  });

  test('viewer can read but every /api/admin write is 403', async () => {
    const login = await loginAs('rbac-viewer@x.local', 'ViewerPass123!');
    expect(login.statusCode).toBe(200);
    expect(login.body.user.role).toBe('viewer');
    const viewerToken = login.body.token;

    const read = await request(app)
      .get('/api/admin/products')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.statusCode).toBe(200);

    const createProductRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ brandId, name: 'Viewer Product', shelfLifeDays: 1, labelLanguage: 'single' });
    expect(createProductRes.statusCode).toBe(403);

    const patchProductRes = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Hacked' });
    expect(patchProductRes.statusCode).toBe(403);

    const deleteProductRes = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(deleteProductRes.statusCode).toBe(403);

    const createBrandRes = await request(app)
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Viewer Brand' });
    expect(createBrandRes.statusCode).toBe(403);

    // Inspection router shares the same admin middleware chain.
    const inspectionWrite = await request(app)
      .post('/api/admin/inspection/templates')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ brandId, name: 'Viewer Template' });
    expect(inspectionWrite.statusCode).toBe(403);
  });

  test('PUT /api/admin/admins/:id updates role/brandId/disabled and reset-password works', async () => {
    const list = await request(app)
      .get('/api/admin/admins')
      .query({ q: 'rbac-brand', limit: 10 })
      .set('Authorization', `Bearer ${platformToken}`);
    const target = list.body.items[0];

    const update = await request(app)
      .put(`/api/admin/admins/${target.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ role: 'viewer', brandId: otherBrandId });
    expect(update.statusCode).toBe(200);
    expect(update.body.admin.role).toBe('viewer');
    expect(update.body.admin.brandId).toBe(otherBrandId);

    const reset = await request(app)
      .post(`/api/admin/admins/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ newPassword: 'FreshPass456!' });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await loginAs('rbac-brand@x.local', 'BrandPass123!');
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await loginAs('rbac-brand@x.local', 'FreshPass456!');
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.body.user.role).toBe('viewer');

    // Disable the account: login is rejected.
    const disable = await request(app)
      .put(`/api/admin/admins/${target.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ disabled: true });
    expect(disable.statusCode).toBe(200);
    expect(disable.body.admin.disabled).toBe(1);
    const disabledLogin = await loginAs('rbac-brand@x.local', 'FreshPass456!');
    expect(disabledLogin.statusCode).toBe(401);

    const audit = await request(app)
      .get('/api/admin/audit-logs')
      .query({ limit: 50 })
      .set('Authorization', `Bearer ${platformToken}`);
    const actions = audit.body.items.map((l) => l.action);
    expect(actions).toContain('admin.update');
    expect(actions).toContain('admin.reset-password');
  });

  test('legacy store token without tokenVersion is accepted while version is 0', async () => {
    const legacyToken = jwt.sign(
      {
        sub: `store:${storeId}`,
        role: 'store',
        tokenType: 'store',
        storeId,
        brandId,
        storeName: 'RBAC Store',
        brandName: 'RBAC Brand'
      },
      JWT_SECRET,
      { expiresIn: '45d' }
    );
    const res = await request(app)
      .get('/api/store/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.storeId).toBe(storeId);
  });

  test('revoke-tokens invalidates issued store tokens; a fresh bind works again', async () => {
    const before = await request(app)
      .get('/api/store/me')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(before.statusCode).toBe(200);

    const revoke = await request(app)
      .post(`/api/admin/stores/${storeId}/revoke-tokens`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(revoke.statusCode).toBe(200);
    expect(revoke.body.store.tokenVersion).toBe(1);

    const after = await request(app)
      .get('/api/store/me')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(after.statusCode).toBe(401);

    // Legacy (version-0) tokens are revoked too.
    const legacyToken = jwt.sign(
      { sub: `store:${storeId}`, role: 'store', tokenType: 'store', storeId, brandId },
      JWT_SECRET,
      { expiresIn: '45d' }
    );
    const legacyAfter = await request(app)
      .get('/api/store/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(legacyAfter.statusCode).toBe(401);

    // Audit point recorded.
    const audit = await request(app)
      .get('/api/admin/audit-logs')
      .query({ action: 'store.tokens.revoke', limit: 10 })
      .set('Authorization', `Bearer ${platformToken}`);
    expect(audit.body.total).toBe(1);

    // A fresh bind issues a token carrying the new version.
    const codeRes = await request(app)
      .post('/api/admin/binding-codes')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ storeId, expiresInHours: 24 });
    const bindRes = await request(app)
      .post('/api/store/bind')
      .send({ code: codeRes.body.bindingCode.code, deviceId: 'rbac-device-02' });
    expect(bindRes.statusCode).toBe(200);
    storeToken = bindRes.body.token;

    const fresh = await request(app)
      .get('/api/store/me')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(fresh.statusCode).toBe(200);
  });

  test('verify-pin locks after 5 consecutive failures, persists across restart, success clears counter', async () => {
    const verify = (id, pin, token = storeToken) =>
      request(app)
        .post(`/api/store/staff/${id}/verify-pin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pin });

    for (let i = 0; i < 5; i += 1) {
      const res = await verify(staffId, 'wrong');
      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(false);
    }

    const locked = await verify(staffId, '1234');
    expect(locked.statusCode).toBe(429);
    expect(locked.body.message).toBeTruthy();
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);

    // Persisted in SQLite: a rebuilt app over the same DB still sees the lock.
    const restartedApp = buildApp({
      db,
      jwtSecret: JWT_SECRET,
      adminWebDir: `${__dirname}/../admin-web`
    });
    const afterRestart = await request(restartedApp)
      .post(`/api/store/staff/${staffId}/verify-pin`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ pin: '1234' });
    expect(afterRestart.statusCode).toBe(429);

    // Success clears the failure streak (second staff, independent counter).
    for (let i = 0; i < 4; i += 1) {
      const res = await verify(secondStaffId, 'wrong');
      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(false);
    }
    const ok = await verify(secondStaffId, '5678');
    expect(ok.statusCode).toBe(200);
    expect(ok.body.valid).toBe(true);

    // The next failure starts from a clean slate (not locked).
    const afterClear = await verify(secondStaffId, 'wrong');
    expect(afterClear.statusCode).toBe(200);
    expect(afterClear.body.valid).toBe(false);
  });
});

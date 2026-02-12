const request = require('supertest');
const { buildApp } = require('../src/app');
const { createDb, closeDb, ensureAdminUser } = require('../src/db');

describe('Admin auth and protection', () => {
  let db;
  let app;

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
  });

  afterAll(async () => {
    await closeDb(db);
  });

  test('rejects admin endpoint access without JWT', async () => {
    const res = await request(app).get('/api/admin/me');
    expect(res.statusCode).toBe(401);
  });

  test('logs in with email/password and returns JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('admin@freshguard.local');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('allows admin endpoint access with bearer JWT', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'StrongPassword123!' });

    const token = login.body.token;
    const res = await request(app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('admin@freshguard.local');
  });

  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@freshguard.local', password: 'wrong-password' });

    expect(res.statusCode).toBe(401);
  });

  test('protects /admin web route and redirects unauthenticated users to login', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });
});

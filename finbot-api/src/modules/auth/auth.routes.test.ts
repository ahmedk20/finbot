/**
 * Integration tests for auth routes.
 *
 * Uses real DB and real HTTP (supertest). No mocks.
 * Why? Mocking Prisma in integration tests hides exactly the bugs
 * you want to catch — constraint violations, query shape errors, migrations.
 *
 * Setup: NODE_ENV=test points to the same DB (finbot).
 * Cleanup: afterEach deletes test data so tests don't bleed into each other.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Delete in dependency order (FK constraints)
async function cleanupTestUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

const TEST_EMAIL    = 'integration-test@finbot.test';
const TEST_PASSWORD = 'Test1234!';

afterEach(() => cleanupTestUser(TEST_EMAIL));

// ── POST /api/v1/auth/register ────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('returns 201 with user object on valid input', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ email: TEST_EMAIL, plan: 'FREE' });
  });

  it('never exposes password hash in response', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.body.data.user.password).toBeUndefined();
  });

  it('returns 409 USER_EXISTS when email is already registered', async () => {
    // Register once
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    // Register again with same email
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EXISTS');
  });

  it('returns 400 VALIDATION_ERROR for weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('response includes X-Correlation-Id header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});

// ── POST /api/v1/auth/dashboard/login ────────────────────────────────────────

describe('POST /api/v1/auth/dashboard/login', () => {
  beforeAll(async () => {
    // Pre-register so login tests have a user to work with
    // This runs once before the describe block, not repeated per test
  });

  it('returns 200 and sets httpOnly cookies on valid credentials', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const res = await request(app)
      .post('/api/v1/auth/dashboard/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(TEST_EMAIL);

    // Both tokens must be set as httpOnly cookies
    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('refresh_token='))).toBe(true);
    // httpOnly — JS cannot read them
    expect(cookies.some((c: string) => c.includes('HttpOnly'))).toBe(true);
  });

  it('returns 401 UNAUTHORIZED on wrong password', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const res = await request(app)
      .post('/api/v1/auth/dashboard/login')
      .send({ email: TEST_EMAIL, password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/dashboard/login')
      .send({ email: 'ghost@nobody.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/auth/keys (create API key) ───────────────────────────────────

describe('POST /api/v1/auth/keys', () => {
  async function loginAndGetCookie(): Promise<string> {
    await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const res = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookies = (res.headers['set-cookie'] as string[]);
    const accessCookie = cookies.find((c: string) => c.startsWith('access_token='))!;
    // Extract just the value: "access_token=<value>; Path=..."
    return accessCookie.split(';')[0];
  }

  it('returns 201 with fullKey starting fb_ (shown only once)', async () => {
    const cookie = await loginAndGetCookie();

    const res = await request(app)
      .post('/api/v1/auth/keys')
      .set('Cookie', cookie)
      .send({ name: 'my-key' });

    expect(res.status).toBe(201);
    expect(res.body.data.fullKey).toMatch(/^fb_/);
    expect(res.body.data.prefix).toBeDefined();
    // fullKey is 67 chars: "fb_" + 64 hex chars
    expect(res.body.data.fullKey).toHaveLength(67);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/keys')
      .send({ name: 'my-key' });

    expect(res.status).toBe(401);
  });

  it('the returned fullKey works as a Bearer token on protected routes', async () => {
    const cookie = await loginAndGetCookie();

    // Create the key
    const createRes = await request(app)
      .post('/api/v1/auth/keys')
      .set('Cookie', cookie)
      .send({ name: 'bearer-test' });

    const { fullKey } = createRes.body.data;

    // Use it on a protected endpoint
    const keysRes = await request(app)
      .get('/api/v1/auth/keys')
      .set('Authorization', `Bearer ${fullKey}`);

    expect(keysRes.status).toBe(200);
    expect(keysRes.body.success).toBe(true);
  });

  it('returns 403 KEY_LIMIT when FREE plan key already exists', async () => {
    const cookie = await loginAndGetCookie();

    // Create first key (FREE plan allows 1)
    await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'key-1' });

    // Try to create second key
    const res = await request(app)
      .post('/api/v1/auth/keys')
      .set('Cookie', cookie)
      .send({ name: 'key-2' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KEY_LIMIT');
  });
});

// ── GET /api/v1/auth/keys ────────────────────────────────────────────────────

describe('GET /api/v1/auth/keys', () => {
  it('lists keys without exposing the keyHash', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c: string) => c.startsWith('access_token='))!.split(';')[0];

    await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'list-test' });

    const res = await request(app).get('/api/v1/auth/keys').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // keyHash must never appear in list response
    expect(res.body.data[0].keyHash).toBeUndefined();
    expect(res.body.data[0].fullKey).toBeUndefined();
    // Prefix is safe to show (it's public-facing)
    expect(res.body.data[0].prefix).toBeDefined();
  });
});

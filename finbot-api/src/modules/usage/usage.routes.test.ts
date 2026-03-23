/**
 * Integration tests — usage routes.
 * Tests auth and response shape. All plans can access /usage.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

const TEST_EMAIL = 'usage-test@finbot.test';
const TEST_PASS  = 'Test1234!';

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  await prisma.usageLog.deleteMany({ where: { userId: user.id } });
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function createUserAndKey(): Promise<string> {
  await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASS });
  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'usage-test' });
  return keyRes.body.data.fullKey;
}

afterEach(cleanup);

describe('GET /api/v1/usage', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/usage');
    expect(res.status).toBe(401);
  });

  it('returns 200 with usage summary for authenticated user', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/usage')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.plan).toBe('FREE');
    expect(data.limits.perMinute).toBe(20);
    expect(data.limits.perDay).toBe(500);
    expect(typeof data.usage.today).toBe('number');
    expect(typeof data.usage.thisMonth).toBe('number');
    expect(data.quota.dailyResetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('period is current year-month', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/usage')
      .set('Authorization', `Bearer ${apiKey}`);

    const now    = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(res.body.data.period).toBe(expected);
  });
});

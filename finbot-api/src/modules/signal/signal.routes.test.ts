/**
 * Integration tests — signal routes.
 *
 * Signal is PRO-gated. Tests auth, plan enforcement, and response shape.
 * Mocks trading-agents and sentiment so no live services needed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

vi.mock('../../shared/llm/llm.client', () => ({
  getIndicators: vi.fn().mockResolvedValue({
    rsi:  55,
    macd: { hist: 0.5, macd: 1.0, signal: 0.5 },
    bb:   { pct_b: 0.5, upper: 155, lower: 135, middle: 145 },
  }),
}));

vi.mock('../sentiment/sentiment.service', () => ({
  getAssetSentiment: vi.fn().mockResolvedValue({
    asset: 'AAPL', score: 0.3, label: 'bullish',
    articleCount: 5, window: '24h',
    breakdown: { bullish: 3, neutral: 1, bearish: 1 },
    computedAt: new Date().toISOString(),
  }),
  invalidateSentimentCache: vi.fn(),
}));

vi.mock('../../shared/cache/l2.cache', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = 'signal-test@finbot.test';
const TEST_PASS  = 'Test1234!';

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function createUserAndKey(plan: 'FREE' | 'PRO' = 'FREE'): Promise<string> {
  await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASS });
  if (plan !== 'FREE') {
    await prisma.user.update({ where: { email: TEST_EMAIL }, data: { plan } });
  }
  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'signal-test' });
  return keyRes.body.data.fullKey;
}

afterEach(cleanup);

describe('GET /api/v1/signal/:asset', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/api/v1/signal/AAPL');
    expect(res.status).toBe(401);
  });

  it('returns 403 TIER_RESTRICTED for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/signal/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TIER_RESTRICTED');
  });

  it('returns 200 with signal response for PRO plan', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .get('/api/v1/signal/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(['bullish', 'neutral', 'bearish']).toContain(res.body.data.outlook);
    expect(res.body.data.decision).toBeUndefined();   // removed — not financial advice
    expect(typeof res.body.data.score).toBe('number');
    expect(['low', 'medium', 'high']).toContain(res.body.data.confidence);
    expect(Array.isArray(res.body.data.components)).toBe(true);
    expect(typeof res.body.data.summary).toBe('string');
    expect(typeof res.body.data.disclaimer).toBe('string');
    expect(res.body.data.asset).toBe('AAPL');
  });

  it('score is between -1 and +1', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .get('/api/v1/signal/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.body.data.score).toBeGreaterThanOrEqual(-1);
    expect(res.body.data.score).toBeLessThanOrEqual(1);
  });
});

/**
 * Integration tests — stocks routes.
 *
 * STARTER plan required. FMP and Polygon clients are mocked.
 * Tests auth, plan gating, and response shape.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

// Mock FMP and Polygon so tests don't hit real APIs
vi.mock('../../shared/market/fmp.client', () => ({
  getFmpProfile: vi.fn().mockResolvedValue({
    symbol: 'AAPL', companyName: 'Apple Inc.', exchange: 'NASDAQ',
    sector: 'Technology', industry: 'Consumer Electronics',
    description: 'Apple Inc. designs and manufactures consumer electronics.',
    ceo: 'Tim Cook', fullTimeEmployees: '164000',
    website: 'https://www.apple.com', country: 'US',
    ipoDate: '1980-12-12', currency: 'USD', isEtf: false,
    price: 175.50, changes: 2.30, changesPercentage: 1.33,
    mktCap: 2_700_000_000_000, pe: 28.5, eps: 6.16, beta: 1.24,
    week52High: 198.23, week52Low: 124.17, avgVolume: 55_000_000,
    dcfDiff: 10, dcf: 185,
  }),
  getFmpFinancials: vi.fn().mockResolvedValue([]),
  getFmpAnalysts:   vi.fn().mockResolvedValue({}),
  getFmpOwnership:  vi.fn().mockResolvedValue([]),
  getFmpEarnings:   vi.fn().mockResolvedValue([]),
  getFmpSegments:   vi.fn().mockResolvedValue({}),
}));

vi.mock('../../shared/market/polygon.client', () => ({
  getSnapshot: vi.fn().mockResolvedValue({
    ticker: 'AAPL', price: 175.50, change: 2.30, changePct: 1.33,
    open: 173.0, high: 176.0, low: 172.5, volume: 55_000_000,
    vwap: 174.80, prevClose: 173.20, lastUpdated: Date.now(),
  }),
  getChart: vi.fn().mockResolvedValue({
    ticker: 'AAPL', range: '1M', timespan: 'day', multiplier: 1,
    candles: [], count: 0,
  }),
}));

vi.mock('../../shared/llm/llm.client', () => ({
  complete:             vi.fn().mockResolvedValue('Apple is a leading tech company.'),
  getIndicators:        vi.fn().mockResolvedValue({ rsi: 55, macd: null, bb: null }),
}));

// Mock stock repository so tests don't hit Postgres for stock data
vi.mock('./stock.repository', () => ({
  getProfile:       vi.fn().mockResolvedValue(null),  // null = not in cache, will fetch from FMP
  isProfileStale:   vi.fn().mockReturnValue(false),
  upsertProfile:    vi.fn().mockResolvedValue({
    ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ',
    sector: 'Technology', industry: 'Consumer Electronics',
    description: 'Apple Inc.', ceo: 'Tim Cook', employees: 164000,
    website: 'https://www.apple.com', country: 'US', ipoDate: '1980-12-12',
    currency: 'USD', isEtf: false, price: 175.50, change: 2.30, changePct: 1.33,
    marketCap: 2_700_000_000_000, pe: 28.5, eps: 6.16, beta: 1.24,
    weekHigh52: 198.23, weekLow52: 124.17, avgVolume: 55_000_000,
    dcfValue: 185, aiSummary: null, cachedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(),
  }),
  updateAiSummary:  vi.fn().mockResolvedValue(undefined),
  getFinancials:    vi.fn().mockResolvedValue(null),
  upsertFinancials: vi.fn().mockResolvedValue(undefined),
  getAnalysts:      vi.fn().mockResolvedValue(null),
  upsertAnalysts:   vi.fn().mockResolvedValue(undefined),
  getOwnership:     vi.fn().mockResolvedValue(null),
  upsertOwnership:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../shared/cache/l2.cache', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = 'stocks-test@finbot.test';
const TEST_PASS  = 'Test1234!';

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  await prisma.stockProfile.deleteMany({ where: { ticker: 'AAPL' } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function createUserAndKey(plan: 'FREE' | 'STARTER' | 'PRO' = 'FREE'): Promise<string> {
  await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASS });
  if (plan !== 'FREE') {
    await prisma.user.update({ where: { email: TEST_EMAIL }, data: { plan } });
  }
  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'stocks-test' });
  return keyRes.body.data.fullKey;
}

afterEach(cleanup);

describe('GET /api/v1/stocks/:ticker', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/stocks/AAPL');
    expect(res.status).toBe(401);
  });

  it('returns 403 for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/stocks/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TIER_RESTRICTED');
  });

  it('returns 200 with profile for STARTER plan', async () => {
    const apiKey = await createUserAndKey('STARTER');
    const res = await request(app)
      .get('/api/v1/stocks/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ticker).toBe('AAPL');
    expect(res.body.data.name).toBeDefined();
    expect(typeof res.body.data.price).toBe('number');
  });
});

describe('GET /api/v1/stocks/:ticker/financials', () => {
  it('returns 403 for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/stocks/AAPL/financials')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
  });

  it('returns 200 for STARTER plan', async () => {
    const apiKey = await createUserAndKey('STARTER');
    const res = await request(app)
      .get('/api/v1/stocks/AAPL/financials')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/stocks/:ticker/ownership', () => {
  it('requires PRO plan', async () => {
    const starterKey = await createUserAndKey('STARTER');
    const res = await request(app)
      .get('/api/v1/stocks/AAPL/ownership')
      .set('Authorization', `Bearer ${starterKey}`);

    expect(res.status).toBe(403);
  });
});

/**
 * Integration tests — news routes.
 *
 * News data comes from Pinecone (mocked). Tests auth, query validation,
 * and response shape — not the actual vector search results.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

// Mock Pinecone so tests don't need a live vector DB
vi.mock('../../shared/db/pinecone.client', () => ({
  embedText:       vi.fn().mockResolvedValue(new Array(384).fill(0)),
  getLiveIndex:    vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ matches: [] }),
    fetch: vi.fn().mockResolvedValue({ records: {} }),
  })),
  getHistoryIndex: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ matches: [] }),
  })),
  querySimilar:    vi.fn().mockResolvedValue({ matches: [] }),
}));

// Mock llm.client — price-history calls go to trading-agents
vi.mock('../../shared/llm/llm.client', () => ({
  complete:    vi.fn().mockResolvedValue({ content: 'summary', model_used: 'test', input_tokens: 0, output_tokens: 0 }),
  getPriceAt:  vi.fn().mockResolvedValue({
    asset: 'BTC', ticker: 'BTC-USD', event_date: '2024-01-15',
    price_at_event: 42000, price_1d_after: 41000, price_7d_after: 39000, price_30d_after: 45000,
    change_1d_pct: -2.38, change_7d_pct: -7.14, change_30d_pct: 7.14,
  }),
}));

vi.mock('../../shared/cache/l2.cache', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), quit: vi.fn() },
  get:   vi.fn().mockResolvedValue(null),
  set:   vi.fn().mockResolvedValue(undefined),
  del:   vi.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = 'news-test@finbot.test';
const TEST_PASS  = 'Test1234!';

async function createUserAndKey(): Promise<string> {
  await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASS });
  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'news-test' });
  return keyRes.body.data.fullKey;
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

afterEach(cleanup);

describe('GET /api/v1/news', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid API key', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.articles)).toBe(true);
  });

  it('returns 400 for invalid limit param', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news?limit=999')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid sentiment filter', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news?sentiment=bullish&limit=5')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid sentiment filter', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news?sentiment=unknown')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/news/breaking', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/api/v1/news/breaking');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid API key', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news/breaking')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/v1/news/:id', () => {
  it('returns 404 for non-existent article', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news/nonexistent-article-id')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/news/:id/context', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/api/v1/news/some-id/context');
    expect(res.status).toBe(401);
  });

  it('returns 404 when article does not exist', async () => {
    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news/nonexistent-id/context')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(404);
  });

  it('returns context with historicalContext when article exists', async () => {
    // Seed getLiveIndex().fetch to return a valid article
    const { getLiveIndex, getHistoryIndex } = await import('../../shared/db/pinecone.client');
    vi.mocked(getLiveIndex).mockReturnValue({
      query: vi.fn().mockResolvedValue({ matches: [] }),
      fetch: vi.fn().mockResolvedValue({
        records: {
          'art_123': {
            metadata: {
              title: 'SEC investigates Binance', url: 'https://example.com',
              source: 'Reuters', sourceTier: 'tier1', asset: 'BTC',
              category: 'regulation', summary: 'SEC opens probe into Binance',
              sentiment: 'bearish', sentimentScore: 0.82, severity: 'high',
              credibility: 0.95, reputation: 85, publishedAt: '2026-03-18T10:00:00Z',
            },
          },
        },
      }),
    } as any);

    // History index returns one similar event
    vi.mocked(getHistoryIndex).mockReturnValue({
      query: vi.fn().mockResolvedValue({
        matches: [{
          id: 'hist_456',
          score: 0.91,
          metadata: {
            title: 'SEC charges Binance securities violations',
            publishedAt: '2023-06-05T14:00:00Z',
            asset: 'BTC', sentiment: 'bearish', sentimentScore: 0.85,
          },
        }],
      }),
    } as any);

    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news/art_123/context')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.article).toBeDefined();
    expect(res.body.data.historicalContext).toBeDefined();
    expect(res.body.data.historicalContext.similarEvents).toBeInstanceOf(Array);
    expect(res.body.data.historicalContext.patternSummary).toBeDefined();
    expect(typeof res.body.data.historicalContext.summary).toBe('string');
  });

  it('includes price outcome data for each similar event', async () => {
    const { getLiveIndex, getHistoryIndex } = await import('../../shared/db/pinecone.client');
    vi.mocked(getLiveIndex).mockReturnValue({
      query: vi.fn().mockResolvedValue({ matches: [] }),
      fetch: vi.fn().mockResolvedValue({
        records: {
          'art_123': {
            metadata: {
              title: 'SEC investigates Binance', url: 'https://example.com',
              source: 'Reuters', sourceTier: 'tier1', asset: 'BTC',
              category: 'regulation', summary: 'SEC opens probe',
              sentiment: 'bearish', sentimentScore: 0.82, severity: 'high',
              credibility: 0.95, reputation: 85, publishedAt: '2026-03-18T10:00:00Z',
            },
          },
        },
      }),
    } as any);

    vi.mocked(getHistoryIndex).mockReturnValue({
      query: vi.fn().mockResolvedValue({
        matches: [{
          id: 'hist_456', score: 0.91,
          metadata: {
            title: 'SEC charges', publishedAt: '2023-06-05T00:00:00Z',
            asset: 'BTC', sentiment: 'bearish', sentimentScore: 0.85,
          },
        }],
      }),
    } as any);

    const apiKey = await createUserAndKey();
    const res = await request(app)
      .get('/api/v1/news/art_123/context')
      .set('Authorization', `Bearer ${apiKey}`);

    const event = res.body.data.historicalContext.similarEvents[0];
    expect(event.priceOutcome).toBeDefined();
    expect(event.priceOutcome.change7dPct).toBeDefined();
    expect(event.similarity).toBeGreaterThan(0.7);
  });
});

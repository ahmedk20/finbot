/**
 * Integration tests — analysis routes.
 *
 * Analysis is PRO-gated. Tests plan enforcement, job submission,
 * and status polling. BullMQ is mocked — no real queue processing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

// Mock BullMQ queue so tests don't need Redis workers running
vi.mock('../../shared/queues/analysis.queue', () => ({
  analysisQueue: {
    add:    vi.fn().mockResolvedValue({ id: 'job_mocked_123' }),
    getJob: vi.fn().mockResolvedValue(null), // null = job not found → 'unknown' status
  },
}));

vi.mock('../../shared/cache/l2.cache', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

// Mock analysis repository — no DB writes for analysis results
vi.mock('./analysis.repository', () => ({
  findResultByJobId:  vi.fn().mockResolvedValue(null),
  findLatestForAsset: vi.fn().mockResolvedValue(null),
  upsertAnalysisResult: vi.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = 'analysis-test@finbot.test';
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
    await prisma.user.update({
      where: { email: TEST_EMAIL },
      data:  { plan },
    });
  }

  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'analysis-test' });
  return keyRes.body.data.fullKey;
}

afterEach(cleanup);

describe('POST /api/v1/analysis — plan gating', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/api/v1/analysis')
      .send({ asset: 'AAPL' });

    expect(res.status).toBe(401);
  });

  it('returns 403 TIER_RESTRICTED for FREE plan users', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .post('/api/v1/analysis')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ asset: 'AAPL' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TIER_RESTRICTED');
  });

  it('returns 202 Accepted for PRO plan users', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .post('/api/v1/analysis')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ asset: 'AAPL' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toBeDefined();
  });

  it('returns 400 VALIDATION_ERROR for missing asset', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .post('/api/v1/analysis')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid date format', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .post('/api/v1/analysis')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ asset: 'AAPL', date: 'not-a-date' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/analysis/job/:jobId', () => {
  it('returns 403 for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/analysis/job/some-job-id')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
  });

  it('returns status for valid job (not found = unknown status)', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .get('/api/v1/analysis/job/nonexistent-job')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(['waiting', 'active', 'completed', 'failed', 'unknown']).toContain(res.body.data.status);
  });
});

describe('GET /api/v1/analysis/latest/:asset', () => {
  it('returns 403 for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/analysis/latest/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when no analysis exists for asset', async () => {
    const apiKey = await createUserAndKey('PRO');
    const res = await request(app)
      .get('/api/v1/analysis/latest/AAPL')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(404);
  });
});

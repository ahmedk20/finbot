/**
 * Integration tests — webhooks routes.
 *
 * Webhooks are BUSINESS-gated. Tests plan enforcement,
 * HTTPS URL requirement, and secret returned only at creation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../shared/db/postgres.client';

const TEST_EMAIL = 'webhook-test@finbot.test';
const TEST_PASS  = 'Test1234!';

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  await prisma.webhook.deleteMany({ where: { userId: user.id } });
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function createUserAndKey(plan: 'FREE' | 'BUSINESS' = 'FREE'): Promise<string> {
  await request(app).post('/api/v1/auth/register').send({ email: TEST_EMAIL, password: TEST_PASS });
  if (plan !== 'FREE') {
    await prisma.user.update({ where: { email: TEST_EMAIL }, data: { plan } });
  }
  const loginRes = await request(app).post('/api/v1/auth/dashboard/login').send({ email: TEST_EMAIL, password: TEST_PASS });
  const cookie = (loginRes.headers['set-cookie'] as string[])
    .find((c: string) => c.startsWith('access_token='))!.split(';')[0];
  const keyRes = await request(app).post('/api/v1/auth/keys').set('Cookie', cookie).send({ name: 'webhook-test' });
  return keyRes.body.data.fullKey;
}

afterEach(cleanup);

describe('POST /api/v1/webhooks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/webhooks').send({
      url: 'https://example.com/hook', event: 'analysis_done',
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 TIER_RESTRICTED for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'analysis_done' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TIER_RESTRICTED');
  });

  it('returns 201 with secret for BUSINESS plan', async () => {
    const apiKey = await createUserAndKey('BUSINESS');
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'analysis_done' });

    expect(res.status).toBe(201);
    expect(res.body.data.secret).toBeDefined();
    // Secret is 64 hex chars (32 random bytes)
    expect(res.body.data.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns 400 for HTTP URL (must be HTTPS)', async () => {
    const apiKey = await createUserAndKey('BUSINESS');
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'http://example.com/hook', event: 'analysis_done' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid event type', async () => {
    const apiKey = await createUserAndKey('BUSINESS');
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'invalid_event' });

    expect(res.status).toBe(400);
  });

  it('rejects threshold outside 0-1 range', async () => {
    const apiKey = await createUserAndKey('BUSINESS');
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'sentiment_change', threshold: 1.5 });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/webhooks', () => {
  it('returns 403 for FREE plan', async () => {
    const apiKey = await createUserAndKey('FREE');
    const res = await request(app)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
  });

  it('returns list without secret field', async () => {
    const apiKey = await createUserAndKey('BUSINESS');

    // Create a webhook
    await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'analysis_done' });

    const res = await request(app)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Secret must never appear in list response
    expect(res.body.data[0]?.secret).toBeUndefined();
  });
});

describe('DELETE /api/v1/webhooks/:id', () => {
  it('returns 404 for non-existent webhook', async () => {
    const apiKey = await createUserAndKey('BUSINESS');
    const res = await request(app)
      .delete('/api/v1/webhooks/nonexistent-id')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(404);
  });

  it('successfully deletes own webhook', async () => {
    const apiKey = await createUserAndKey('BUSINESS');

    const createRes = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ url: 'https://example.com/hook', event: 'analysis_done' });

    const webhookId = createRes.body.data.id;

    const deleteRes = await request(app)
      .delete(`/api/v1/webhooks/${webhookId}`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(deleteRes.status).toBe(200);
  });
});

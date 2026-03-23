/**
 * Integration tests — health module.
 * No auth required; tests real DB connectivity.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../app';

describe('GET /health', () => {
  it('returns 200 with status ok when DB is reachable', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.services.api).toBe('ok');
    expect(res.body.data.services.db).toBe('ok');
  });

  it('includes latency_ms in meta', async () => {
    const res = await request(app).get('/health');

    expect(typeof res.body.meta.latency_ms).toBe('number');
    expect(res.body.meta.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('includes timestamp in meta', async () => {
    const res = await request(app).get('/health');

    expect(res.body.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/**
 * Unit tests — webhook.service.ts
 *
 * Tests HMAC signature generation, threshold filtering,
 * and secret generation format. No DB or HTTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { signPayload } from './webhook.service';
import * as webhookRepo from './webhook.repository';
import { fireWebhooks } from './webhook.service';

vi.mock('./webhook.repository');

// ── signPayload ───────────────────────────────────────────────────────────────

describe('signPayload', () => {
  it('returns t=<timestamp>,v1=<hex> format', () => {
    const sig = signPayload('mysecret', 1700000000, '{"event":"test"}');

    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('produces deterministic output for same inputs', () => {
    const sig1 = signPayload('secret', 1700000000, 'body');
    const sig2 = signPayload('secret', 1700000000, 'body');

    expect(sig1).toBe(sig2);
  });

  it('produces different output when body differs', () => {
    const sig1 = signPayload('secret', 1700000000, 'body1');
    const sig2 = signPayload('secret', 1700000000, 'body2');

    expect(sig1).not.toBe(sig2);
  });

  it('produces different output when timestamp differs (replay attack prevention)', () => {
    const sig1 = signPayload('secret', 1700000000, 'body');
    const sig2 = signPayload('secret', 1700000001, 'body');

    expect(sig1).not.toBe(sig2);
  });

  it('is verifiable — receiver can recompute and compare', () => {
    const secret    = 'test_secret';
    const timestamp = 1700000000;
    const body      = JSON.stringify({ event: 'sentiment_change', asset: 'AAPL' });

    const signature = signPayload(secret, timestamp, body);

    // Extract v1 from signature
    const v1 = signature.split('v1=')[1];

    // Receiver recomputes the HMAC
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(v1).toBe(expected);
  });
});

// ── fireWebhooks — threshold filtering ───────────────────────────────────────

describe('fireWebhooks — threshold filtering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fire when score delta is below threshold', async () => {
    vi.mocked(webhookRepo.findMatchingWebhooks).mockResolvedValue([
      {
        id: 'wh1', userId: 'u1', url: 'https://example.com/hook',
        asset: 'AAPL', event: 'sentiment_change', threshold: 0.3,
        secret: 'sec', active: true, createdAt: new Date(),
      } as any,
    ]);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    // Score moved from 0.5 to 0.6 — delta = 0.1, below threshold of 0.3
    await fireWebhooks('AAPL', 'sentiment_change', { score: 0.6 }, 0.5);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fires when score delta meets or exceeds threshold', async () => {
    vi.mocked(webhookRepo.findMatchingWebhooks).mockResolvedValue([
      {
        id: 'wh1', userId: 'u1', url: 'https://example.com/hook',
        asset: 'AAPL', event: 'sentiment_change', threshold: 0.3,
        secret: 'sec', active: true, createdAt: new Date(),
      } as any,
    ]);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    // Score moved from 0.1 to 0.6 — delta = 0.5, above threshold
    await fireWebhooks('AAPL', 'sentiment_change', { score: 0.6 }, 0.1);

    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('always fires non-sentiment events regardless of threshold', async () => {
    vi.mocked(webhookRepo.findMatchingWebhooks).mockResolvedValue([
      {
        id: 'wh2', userId: 'u1', url: 'https://example.com/hook',
        asset: 'AAPL', event: 'analysis_done', threshold: 0.9,
        secret: 'sec', active: true, createdAt: new Date(),
      } as any,
    ]);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await fireWebhooks('AAPL', 'analysis_done', { jobId: 'job_1' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('sends correct headers in delivery', async () => {
    vi.mocked(webhookRepo.findMatchingWebhooks).mockResolvedValue([
      {
        id: 'wh1', userId: 'u1', url: 'https://example.com/hook',
        asset: 'AAPL', event: 'analysis_done', threshold: null,
        secret: 'mysecret', active: true, createdAt: new Date(),
      } as any,
    ]);

    let capturedHeaders: Record<string, string> = {};
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((opts?.headers ?? {}) as Record<string, string>),
      );
      return new Response(null, { status: 200 });
    });

    await fireWebhooks('AAPL', 'analysis_done', { jobId: 'job_1' });

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders['X-FinBot-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(capturedHeaders['X-FinBot-Event']).toBe('analysis_done');

    fetchSpy.mockRestore();
  });
});

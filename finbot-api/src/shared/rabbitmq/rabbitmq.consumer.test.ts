/**
 * Unit tests — RabbitMQ consumer.
 *
 * Tests the dispatch logic: correct handler called, ack on success,
 * nack+requeue on handler failure, nack+discard on parse error,
 * ack+skip when no handler registered.
 *
 * We mock the channel directly — no real broker needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock BEFORE importing consumer (vi.mock is hoisted)
vi.mock('./rabbitmq.client', () => ({
  QUEUE_API:  'finbot.api.news',
  getChannel: vi.fn(),
}));

import { registerHandler, startConsuming } from './rabbitmq.consumer';
import { getChannel } from './rabbitmq.client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(payload: object) {
  return {
    content: Buffer.from(JSON.stringify(payload)),
  };
}

function makeMockChannel(consumerCallback?: (msg: any) => Promise<void>) {
  const ack  = vi.fn();
  const nack = vi.fn();
  const consume = vi.fn().mockImplementation(async (_queue: string, cb: Function) => {
    if (consumerCallback) await consumerCallback(cb);
  });

  return { ack, nack, consume, prefetch: vi.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('startConsuming() — message dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the registered handler with correct payload and acks the message', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHandler('news.critical', handler);

    const msg = makeMessage({
      event:       'news.critical',
      payload:     { articleId: 'art_1', asset: 'BTC', title: 'Rally', severity: 'high' },
      publishedAt: new Date().toISOString(),
    });

    let capturedCb: ((msg: any) => Promise<void>) | undefined;
    const ch = makeMockChannel(cb => { capturedCb = cb; return Promise.resolve(); });
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();
    await capturedCb!(msg);

    expect(handler).toHaveBeenCalledWith({
      articleId: 'art_1',
      asset:     'BTC',
      title:     'Rally',
      severity:  'high',
    });
    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('nacks with requeue when handler throws (at-least-once delivery)', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('webhook timeout'));
    registerHandler('news.critical', handler);

    const msg = makeMessage({
      event:   'news.critical',
      payload: { articleId: 'art_2', asset: 'ETH', title: 'Crash', severity: 'high' },
      publishedAt: new Date().toISOString(),
    });

    let capturedCb: ((msg: any) => Promise<void>) | undefined;
    const ch = makeMockChannel(cb => { capturedCb = cb; return Promise.resolve(); });
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();
    await capturedCb!(msg);

    expect(ch.nack).toHaveBeenCalledWith(msg, false, true); // requeue: true
    expect(ch.ack).not.toHaveBeenCalled();
  });

  it('nacks without requeue (discards) when message JSON is malformed', async () => {
    const badMsg = {
      content: Buffer.from('not valid json {{{{'),
    };

    let capturedCb: ((msg: any) => Promise<void>) | undefined;
    const ch = makeMockChannel(cb => { capturedCb = cb; return Promise.resolve(); });
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();
    await capturedCb!(badMsg);

    expect(ch.nack).toHaveBeenCalledWith(badMsg, false, false); // requeue: false (discard)
    expect(ch.ack).not.toHaveBeenCalled();
  });

  it('acks and skips when no handler registered for the event', async () => {
    const msg = makeMessage({
      event:       'billing.upgraded',   // no handler registered for this
      payload:     { userId: 'u_1', previousPlan: 'FREE', newPlan: 'PRO' },
      publishedAt: new Date().toISOString(),
    });

    let capturedCb: ((msg: any) => Promise<void>) | undefined;
    const ch = makeMockChannel(cb => { capturedCb = cb; return Promise.resolve(); });
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();
    await capturedCb!(msg);

    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('ignores null message (consumer cancelled by broker)', async () => {
    let capturedCb: ((msg: any) => Promise<void>) | undefined;
    const ch = makeMockChannel(cb => { capturedCb = cb; return Promise.resolve(); });
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();

    // null = broker cancelled the consumer — should not crash
    await expect(capturedCb!(null)).resolves.toBeUndefined();
    expect(ch.ack).not.toHaveBeenCalled();
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('sets prefetch(1) to process one message at a time', async () => {
    const ch = makeMockChannel();
    vi.mocked(getChannel).mockReturnValue(ch as any);

    await startConsuming();

    expect(ch.prefetch).toHaveBeenCalledWith(1);
  });
});

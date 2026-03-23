/**
 * Unit tests — RabbitMQ publisher.
 *
 * We mock getChannel() because we don't need a real broker to test
 * that the publisher serializes correctly, sets the right headers,
 * and handles errors without throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publish } from './rabbitmq.publisher';

// Mock the client so we control what getChannel() returns
vi.mock('./rabbitmq.client', () => ({
  EXCHANGE:   'finbot.events',
  getChannel: vi.fn(),
}));

import { getChannel } from './rabbitmq.client';

describe('publish()', () => {
  const mockPublish = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChannel).mockReturnValue({ publish: mockPublish } as any);
  });

  it('calls channel.publish with correct exchange and empty routing key', () => {
    publish('news.critical', {
      articleId: 'art_1',
      asset:     'BTC',
      title:     'BTC rallies',
      severity:  'high',
    });

    expect(mockPublish).toHaveBeenCalledOnce();
    const [exchange, routingKey] = mockPublish.mock.calls[0];
    expect(exchange).toBe('finbot.events');
    expect(routingKey).toBe('');  // fanout ignores routing key — we send ''
  });

  it('serializes event name and payload into message buffer', () => {
    publish('news.critical', {
      articleId: 'art_1',
      asset:     'BTC',
      title:     'BTC rallies',
      severity:  'high',
    });

    const buffer: Buffer = mockPublish.mock.calls[0][2];
    const parsed = JSON.parse(buffer.toString());

    expect(parsed.event).toBe('news.critical');
    expect(parsed.payload.articleId).toBe('art_1');
    expect(parsed.payload.asset).toBe('BTC');
    expect(parsed.publishedAt).toBeDefined();
  });

  it('sets persistent: true so messages survive broker restart', () => {
    publish('news.critical', {
      articleId: 'art_1',
      asset:     'BTC',
      title:     'BTC rallies',
      severity:  'high',
    });

    const options = mockPublish.mock.calls[0][3];
    expect(options.persistent).toBe(true);
    expect(options.contentType).toBe('application/json');
  });

  it('sets x-event-type header for routing visibility', () => {
    publish('news.critical', {
      articleId: 'art_1',
      asset:     'BTC',
      title:     'BTC rallies',
      severity:  'high',
    });

    const options = mockPublish.mock.calls[0][3];
    expect(options.headers['x-event-type']).toBe('news.critical');
  });

  it('does not throw when channel.publish throws (fire-and-forget)', () => {
    mockPublish.mockImplementation(() => { throw new Error('broker down'); });

    // Must not throw — publish is fire-and-forget, never crashes the caller
    expect(() =>
      publish('news.critical', {
        articleId: 'art_1',
        asset:     'BTC',
        title:     'BTC rallies',
        severity:  'high',
      }),
    ).not.toThrow();
  });

  it('does not throw when getChannel throws (e.g. not connected yet)', () => {
    vi.mocked(getChannel).mockImplementation(() => { throw new Error('not connected'); });

    expect(() =>
      publish('news.critical', {
        articleId: 'art_1',
        asset:     'BTC',
        title:     'BTC rallies',
        severity:  'high',
      }),
    ).not.toThrow();
  });
});

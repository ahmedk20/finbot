/**
 * Unit tests — sentiment.service.ts
 *
 * Tests the time-weighted scoring formula and cache behaviour
 * without hitting Redis or Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sentimentRepo from './sentiment.repository';
import * as l2 from '../../shared/cache/l2.cache';
import { getAssetSentiment, invalidateSentimentCache } from './sentiment.service';

vi.mock('./sentiment.repository');
vi.mock('../../shared/cache/l2.cache');
vi.mock('../../shared/queues/sentiment.queue', () => ({
  sentimentQueue: { add: vi.fn() },
}));

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

describe('getAssetSentiment — scoring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AssetNotFound when no rows exist', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([]);

    await expect(
      getAssetSentiment('AAPL', { window: '24h' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns bullish label when score > 0.2', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score: 0.8, label: 'bullish', createdAt: hoursAgo(1) },
      { score: 0.7, label: 'bullish', createdAt: hoursAgo(2) },
    ]);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    expect(result.label).toBe('bullish');
    expect(result.score).toBeGreaterThan(0.2);
  });

  it('returns bearish label when score < -0.2', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score: -0.9, label: 'bearish', createdAt: hoursAgo(1) },
    ]);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    expect(result.label).toBe('bearish');
    expect(result.score).toBeLessThan(-0.2);
  });

  it('returns neutral label when score is between -0.2 and 0.2', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score:  0.1, label: 'neutral', createdAt: hoursAgo(1) },
      { score: -0.1, label: 'neutral', createdAt: hoursAgo(2) },
    ]);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    expect(result.label).toBe('neutral');
    expect(Math.abs(result.score)).toBeLessThanOrEqual(0.2);
  });

  it('weighs recent articles higher than old ones', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);

    // One very recent bullish article vs one old bearish article
    // Recent should dominate — result should be positive
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score:  1.0, label: 'bullish', createdAt: hoursAgo(0.5) },  // 30 min ago, high weight
      { score: -1.0, label: 'bearish', createdAt: hoursAgo(23) },   // 23 h ago, very low weight
    ]);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    expect(result.score).toBeGreaterThan(0);
  });

  it('returns cached result without hitting the DB', async () => {
    const cached = {
      asset: 'AAPL', score: 0.5, label: 'bullish' as const,
      articleCount: 3, window: '24h' as const,
      breakdown: { bullish: 3, neutral: 0, bearish: 0 },
      computedAt: new Date().toISOString(),
    };
    vi.mocked(l2.get).mockResolvedValue(cached);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    expect(result).toEqual(cached);
    expect(sentimentRepo.findByAsset).not.toHaveBeenCalled();
  });

  it('rounds score to 3 decimal places', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score: 0.123456789, label: 'neutral', createdAt: hoursAgo(1) },
    ]);

    const result = await getAssetSentiment('AAPL', { window: '24h' });

    const decimalPlaces = (result.score.toString().split('.')[1] ?? '').length;
    expect(decimalPlaces).toBeLessThanOrEqual(3);
  });

  it('normalises asset to uppercase', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentRepo.findByAsset).mockResolvedValue([
      { score: 0.5, label: 'bullish', createdAt: hoursAgo(1) },
    ]);

    const result = await getAssetSentiment('aapl', { window: '24h' });

    expect(result.asset).toBe('AAPL');
  });
});

describe('invalidateSentimentCache', () => {
  it('deletes both 24h and 7d cache keys', async () => {
    vi.mocked(l2.del).mockResolvedValue(undefined);

    await invalidateSentimentCache('AAPL');

    expect(l2.del).toHaveBeenCalledWith('sentiment:AAPL:24h');
    expect(l2.del).toHaveBeenCalledWith('sentiment:AAPL:7d');
    expect(vi.mocked(l2.del)).toHaveBeenCalledTimes(2);
  });
});

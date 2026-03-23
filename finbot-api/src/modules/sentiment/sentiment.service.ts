import * as sentimentRepo from './sentiment.repository';
import { sentimentQueue } from '../../shared/queues/sentiment.queue';
import { AssetNotFound } from './sentiment.errors';
import * as l2 from '../../shared/cache/l2.cache';
import type { AssetSentiment, SentimentJobData } from './sentiment.types';
import type { SentimentQuery } from './sentiment.schema';

// Sentiment scores change as new articles are processed — 2 min TTL is a reasonable freshness trade-off.
// The sentiment worker invalidates these keys whenever a new score is written for that asset.
const SENTIMENT_TTL_SEC = 120;

const WINDOW_HOURS: Record<string, number> = {
  '24h': 24,
  '7d':  168,
};

// Time-weighted average: recent articles influence the score more than old ones.
// Weight = 1 / (hours_since_published + 1)
// An article from 1h ago has weight 0.5. One from 24h ago has weight ~0.04.
function timeWeightedAverage(
  rows: Array<{ score: number; label: string; createdAt: Date }>,
): number {
  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const hoursAgo = (now - row.createdAt.getTime()) / (1000 * 60 * 60);
    const weight   = 1 / (hoursAgo + 1);
    weightedSum   += row.score * weight;
    totalWeight   += weight;
  }

  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function scoreToLabel(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score >  0.2) return 'bullish';
  if (score < -0.2) return 'bearish';
  return 'neutral';
}

export async function getAssetSentiment(
  asset:  string,
  params: SentimentQuery,
): Promise<AssetSentiment> {
  const key = `sentiment:${asset.toUpperCase()}:${params.window}`;

  const cached = await l2.get<AssetSentiment>(key);
  if (cached) return cached;

  const windowHours = WINDOW_HOURS[params.window];
  const rows = await sentimentRepo.findByAsset(asset.toUpperCase(), windowHours);

  if (rows.length === 0) throw AssetNotFound();

  const score = timeWeightedAverage(rows);
  const label = scoreToLabel(score);

  const breakdown = { bullish: 0, neutral: 0, bearish: 0 };
  for (const row of rows) {
    breakdown[row.label as keyof typeof breakdown]++;
  }

  const result: AssetSentiment = {
    asset:        asset.toUpperCase(),
    score:        Math.round(score * 1000) / 1000,
    label,
    articleCount: rows.length,
    window:       params.window,
    breakdown,
    computedAt:   new Date().toISOString(),
  };

  await l2.set(key, result, SENTIMENT_TTL_SEC);
  return result;
}

// Called by the sentiment worker after writing a new score — ensures next read is fresh.
export async function invalidateSentimentCache(asset: string): Promise<void> {
  await Promise.all([
    l2.del(`sentiment:${asset}:24h`),
    l2.del(`sentiment:${asset}:7d`),
  ]);
}

// Called by the internal ingest endpoint — enqueues a BullMQ job
export async function enqueueAnalysis(data: SentimentJobData): Promise<void> {
  await sentimentQueue.add('analyze-article', data, {
    jobId: `sentiment:${data.articleId}`, // deduplication — same article won't queue twice
  });
}

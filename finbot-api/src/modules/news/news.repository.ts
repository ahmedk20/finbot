import { embedText, querySimilar, getLiveIndex, getHistoryIndex } from '../../shared/db/pinecone.client';
import type { NewsItem, NewsQuery, Sentiment, Severity, SourceTier, SimilarHistoricalEvent } from './news.types';

// ── Pinecone metadata filter ──────────────────────────────────────────────────

function buildFilter(params: NewsQuery): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  if (params.asset)     conditions.push({ asset:      { $eq: params.asset } });
  if (params.sentiment) conditions.push({ sentiment:  { $eq: params.sentiment } });
  if (params.severity)  conditions.push({ severity:   { $eq: params.severity } });
  if (params.tier)      conditions.push({ sourceTier: { $eq: params.tier } });

  const since = Math.floor(Date.now() / 1000) - params.hours * 3600;
  conditions.push({ publishedAt_ts: { $gte: since } });

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

// ── Parse Pinecone record → NewsItem ─────────────────────────────────────────

function parseRecord(
  id: string,
  metadata: Record<string, unknown> | undefined,
  score?: number,
): NewsItem | null {
  if (!metadata?.title) return null;

  return {
    id,
    title:          metadata.title as string,
    url:            metadata.url as string,
    source:         metadata.source as string,
    sourceTier:     metadata.sourceTier as SourceTier,
    asset:          metadata.asset as string,
    category:       metadata.category as string,
    summary:        (metadata.summary as string) ?? '',
    sentiment:      metadata.sentiment as Sentiment,
    sentimentScore: metadata.sentimentScore as number,
    severity:       metadata.severity as Severity,
    credibility:    metadata.credibility as number,
    reputation:     metadata.reputation as number,
    publishedAt:    metadata.publishedAt as string,
    score,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export async function findMany(params: NewsQuery): Promise<NewsItem[]> {
  const embedInput = params.query ?? `${params.asset ?? 'crypto'} financial news`;
  const vector = await embedText(embedInput);
  const filter = buildFilter(params);

  const result = await querySimilar('finbot-live', vector, { topK: params.limit, filter });
  return result.matches
    .map(m => parseRecord(m.id, m.metadata as Record<string, unknown> | undefined, m.score))
    .filter(Boolean) as NewsItem[];
}

export async function findBreaking(limit: number): Promise<NewsItem[]> {
  const since = Math.floor(Date.now() / 1000) - 2 * 3600;
  const vector = await embedText('breaking crypto financial news');

  const result = await querySimilar('finbot-live', vector, {
    topK: limit,
    filter: {
      $and: [
        { sourceTier: { $in: ['tier1', 'tier2'] } },
        { publishedAt_ts: { $gte: since } },
      ],
    },
  });

  const articles = result.matches
    .map(m => parseRecord(m.id, m.metadata as Record<string, unknown> | undefined, m.score))
    .filter(Boolean) as NewsItem[];

  return articles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export async function findById(id: string): Promise<NewsItem | null> {
  const result = await getLiveIndex().fetch({ ids: [id] });
  const record = result.records?.[id];
  if (!record) return null;
  return parseRecord(id, record.metadata as Record<string, unknown> | undefined);
}

/**
 * Find historically similar events for a given article text.
 *
 * Queries finbot-history namespace (2017-2025 archive) using the same
 * embedding model as live articles. Returns top matches ranked by
 * cosine similarity — these are events where the narrative was semantically
 * closest to the current article.
 *
 * excludeAsset: optionally match only the same asset (tighter comparison).
 */
export async function findSimilarHistorical(
  text:    string,
  limit:   number = 5,
  asset?:  string,
): Promise<Omit<SimilarHistoricalEvent, 'priceOutcome'>[]> {
  const vector = await embedText(text);

  const filter: Record<string, unknown> = asset
    ? { asset: { $eq: asset.toUpperCase() } }
    : {};

  const result = await getHistoryIndex().query({
    vector,
    topK:            limit,
    filter:          Object.keys(filter).length ? filter : undefined,
    includeMetadata: true,
  });

  return result.matches
    .filter(m => m.metadata?.title && m.score != null && m.score > 0.70) // min 70% similarity
    .map(m => ({
      id:             m.id,
      title:          m.metadata!.title as string,
      publishedAt:    m.metadata!.publishedAt as string,
      asset:          m.metadata!.asset as string ?? 'UNKNOWN',
      sentiment:      m.metadata!.sentiment as Sentiment,
      sentimentScore: m.metadata!.sentimentScore as number,
      similarity:     Math.round((m.score ?? 0) * 1000) / 1000,
    }));
}

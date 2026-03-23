import { Pinecone } from '@pinecone-database/pinecone';
import pino from 'pino';
import { env } from '../config/env';
import { ScoredArticle } from './sentiment';

export interface UpsertResult {
  upserted: number;
  failed:   number;
}

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });
const pc     = new Pinecone({ apiKey: env.PINECONE_API_KEY });
const index  = pc.index(env.PINECONE_INDEX_NAME).namespace('finbot-live');

const BATCH_SIZE = 100;

export async function upsertArticles(scored: ScoredArticle[]): Promise<UpsertResult> {
  let upserted = 0;
  let failed   = 0;

  for (let i = 0; i < scored.length; i += BATCH_SIZE) {
    const batch   = scored.slice(i, i + BATCH_SIZE);
    const records = batch.map(e => ({
      id:     e.article.id,
      values: e.vector,
      metadata: {
        title:          e.article.title,
        url:            e.article.url,
        source:         e.article.source,
        sourceTier:     e.article.sourceTier,
        credibility:    e.article.credibility,
        reputation:     e.article.reputation,
        asset:          e.article.asset,
        category:       e.article.category,
        publishedAt:    e.article.publishedAt,
        publishedAt_ts: Math.floor(new Date(e.article.publishedAt).getTime() / 1000),
        summary:        e.article.summary,
        sentiment:      e.sentiment,       // real FinBERT label
        sentimentScore: e.sentimentScore,  // real FinBERT confidence
        severity:       e.severity,        // derived from score
      },
    }));

    try {
      await index.upsert({ records });
      upserted += batch.length;
      logger.info({ batch: i / BATCH_SIZE + 1, count: batch.length }, 'Batch upserted');
    } catch (err) {
      failed += batch.length;
      logger.warn({ err: (err as Error).message }, 'Batch upsert failed');
    }
  }

  logger.info({ upserted, failed }, 'Upsert complete');
  return { upserted, failed };
}

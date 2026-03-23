import { Worker } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { complete } from '../llm/llm.client';
import { findById } from '../../modules/news/news.repository';
import { upsertScore } from '../../modules/sentiment/sentiment.repository';
import { getAssetSentiment, invalidateSentimentCache } from '../../modules/sentiment/sentiment.service';
import { buildSentimentPrompt } from '../../modules/sentiment/sentiment.prompts';
import { LLMParseError } from '../../modules/sentiment/sentiment.errors';
import { publisher, CHANNELS } from '../streaming/redis.pubsub';
import { fireWebhooks }        from '../../modules/webhooks';
import type { SentimentJobData, LLMSentimentResult } from '../../modules/sentiment/sentiment.types';

const connection = {
  host:     new URL(env.REDIS_URL).hostname,
  port:     Number(new URL(env.REDIS_URL).port) || 6379,
  password: new URL(env.REDIS_URL).password || undefined,
};

// Parse and validate what the LLM returned.
// The LLM might hallucinate wrong field names, wrong types, or wrap JSON in markdown.
// We never trust LLM output — we validate every field.
function parseLLMResponse(raw: string, model_used: string): LLMSentimentResult {
  // Strip markdown code fences if LLM wraps response in ```json ... ```
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw LLMParseError();
  }

  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as Record<string, unknown>).score !== 'number' ||
    typeof (parsed as Record<string, unknown>).label !== 'string' ||
    typeof (parsed as Record<string, unknown>).reasoning !== 'string'
  ) {
    throw LLMParseError();
  }

  const result = parsed as { score: number; label: string; reasoning: string };

  // Clamp score to valid range — never trust external data without bounds checking
  const score = Math.max(-1, Math.min(1, result.score));

  // Normalise label — LLM might return "Bullish" or "BULLISH"
  const rawLabel  = result.label.toLowerCase();
  const label     = ['bullish', 'bearish', 'neutral'].includes(rawLabel)
    ? rawLabel as 'bullish' | 'bearish' | 'neutral'
    : 'neutral';

  return { score, label, reasoning: result.reasoning, model_used };
}

export const sentimentWorker = new Worker<SentimentJobData>(
  'sentiment',
  async (job) => {
    const { articleId, asset } = job.data;

    logger.info({ articleId, asset, jobId: job.id }, 'Processing sentiment job');

    // Step 1: fetch the article from Pinecone
    const article = await findById(articleId);
    if (!article) {
      // Article deleted from Pinecone — discard job, don't retry
      logger.warn({ articleId }, 'Article not found in Pinecone — discarding job');
      return;
    }

    // Step 2: build prompt and call LLM
    const prompt = buildSentimentPrompt(asset, article.title, article.summary);
    const llmResponse = await complete(
      [
        { role: 'system', content: 'You are a financial sentiment analysis expert. Always respond with valid JSON only.' },
        { role: 'user',   content: prompt },
      ],
      { temperature: 0.1, max_tokens: 200 }, // low temperature = consistent, deterministic output
    );

    // Step 3: parse and validate LLM output
    const result = parseLLMResponse(llmResponse.content, llmResponse.model_used);

    // Step 4: store in Postgres (upsert — safe to retry)
    await upsertScore(articleId, asset, result);

    // Invalidate cached sentiment so next read recomputes from the new score
    await invalidateSentimentCache(asset);

    // Step 5: publish updated aggregated sentiment to Redis pub/sub (SSE) + fire webhooks
    // Both are fire-and-forget — the DB write already succeeded, that's the source of truth.
    try {
      const aggregated = await getAssetSentiment(asset, { window: '24h' });
      const event      = { ...aggregated, updatedAt: new Date().toISOString() };

      await publisher.publish(CHANNELS.sentiment(asset), JSON.stringify(event));

      // Fire webhooks for all registered sentiment_change listeners on this asset.
      // Pass result.score as the new score — threshold filtering happens inside fireWebhooks.
      await fireWebhooks(asset, 'sentiment_change', event);
    } catch (err) {
      logger.warn(err, 'Failed to publish sentiment event or fire webhooks — clients will not be notified');
    }

    logger.info(
      { articleId, asset, score: result.score, label: result.label, model: result.model_used },
      'Sentiment job complete',
    );
  },
  {
    connection,
    concurrency: 3, // process 3 articles simultaneously — LLM calls are I/O bound
  },
);

sentimentWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Sentiment job failed');
});

sentimentWorker.on('error', (err) => {
  logger.error(err, 'Sentiment worker error');
});

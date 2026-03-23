import pino from 'pino';
import { runScrape } from '../scraper/index';
import { embedArticles } from './embedder';
import { scoreArticles } from './sentiment';
import { upsertArticles } from './upserter';
import { publishNewsEvent } from '../shared/rabbitmq/rabbitmq.publisher';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

export async function runPipeline(): Promise<void> {
  logger.info('Pipeline starting...');

  // Step 1 — Scrape all RSS sources
  const { articles, totalFetched, sourcesFailed, durationMs } = await runScrape();
  logger.info({ totalFetched, sourcesFailed, durationMs }, 'Scrape done');

  if (articles.length === 0) {
    logger.warn('No articles scraped — skipping embed and upsert');
    return;
  }

  // Step 2 — Embed articles (title + summary → 384-dim vector)
  const embedded = await embedArticles(articles);
  logger.info({ embedded: embedded.length }, 'Embedding done');

  if (embedded.length === 0) {
    logger.warn('No articles embedded — skipping upsert');
    return;
  }

  // Step 3 — Score sentiment with FinBERT (bullish / bearish / neutral + confidence)
  const scored = await scoreArticles(embedded);
  logger.info({ scored: scored.length }, 'Sentiment scoring done');

  // Step 4 — Upsert into Pinecone
  const { upserted, failed } = await upsertArticles(scored);
  logger.info({ upserted, failed }, 'Pipeline complete');

  // Step 5 — Publish high-severity articles to RabbitMQ for webhook fan-out
  const critical = scored.filter(a => a.severity === 'high');
  for (const article of critical) {
    publishNewsEvent({
      articleId:      article.article.id,
      asset:          article.article.asset ?? 'UNKNOWN',
      title:          article.article.title,
      severity:       article.severity,
      sentiment:      article.sentiment,
      sentimentScore: article.sentimentScore,
    });
  }

  if (critical.length > 0) {
    logger.info({ count: critical.length }, 'High-severity articles published to RabbitMQ');
  }
}

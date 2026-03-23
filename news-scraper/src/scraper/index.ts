/**
 * Scraper orchestrator — fetches all RSS sources and returns normalized Articles.
 *
 * Flow:
 *  1. Reset seen-URL set (fresh dedup per run)
 *  2. Fetch all sources concurrently (p-limit controls max concurrency)
 *  3. Normalize each RSS item → Article
 *  4. Skip duplicates (same URL already seen this run)
 *  5. Return all clean articles + per-run stats
 */

import Parser from 'rss-parser';
import pLimit from 'p-limit';
import pino from 'pino';

import { CRYPTO_SOURCES, CryptoSource } from '../sources/crypto.sources';
import { Article } from '../types/article';
import { normalizeItem, RssItem } from '../pipeline/normalizer';
import { hasSeen, markSeen, resetSeen } from './dedupe';
import { env } from '../config/env';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });
const parser = new Parser({ timeout: 10_000, headers: { 'User-Agent': 'finbot-scraper/1.0' } });

// ─── Per-source fetch ──────────────────────────────────────────────────────────

interface SourceResult {
  articles: Article[];
  failed:   boolean;
}

async function fetchSource(source: CryptoSource): Promise<SourceResult> {
  try {
    const feed    = await parser.parseURL(source.url);
    const articles: Article[] = [];

    for (const item of (feed.items as RssItem[])) {
      const article = normalizeItem(item, source);

      if (!article)             continue; // missing title or url
      if (hasSeen(article.url)) continue; // duplicate this run

      markSeen(article.url);
      articles.push(article);
    }

    logger.info({ source: source.name, count: articles.length }, 'Fetched source');
    return { articles, failed: false };

  } catch (err) {
    // One source failing does not kill the whole job
    logger.warn({ source: source.name, err: (err as Error).message }, 'Source failed — skipping');
    return { articles: [], failed: true };
  }
}

// ─── Main scrape run ───────────────────────────────────────────────────────────

export interface ScrapeResult {
  articles:      Article[];
  totalFetched:  number;
  totalSkipped:  number;
  sourcesFailed: number;
  durationMs:    number;
}

export async function runScrape(sources = CRYPTO_SOURCES): Promise<ScrapeResult> {
  const start = Date.now();
  resetSeen(); // fresh dedup for this run

  const limit   = pLimit(env.SCRAPER_CONCURRENCY); // default 5 from env
  const results = await Promise.all(
    sources.map(source => limit(() => fetchSource(source)))
  );

  const articles      = results.flatMap(r => r.articles);
  const sourcesFailed = results.filter(r => r.failed).length;
  const totalFetched  = articles.length;
  const totalSkipped  = sources.length - sourcesFailed - results.filter(r => r.articles.length > 0).length;

  const durationMs = Date.now() - start;

  logger.info(
    { totalFetched, totalSkipped, sourcesFailed, durationMs },
    'Scrape run complete',
  );

  return { articles, totalFetched, totalSkipped, sourcesFailed, durationMs };
}

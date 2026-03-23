import { l1 } from '../../shared/cache/l1.cache';
import * as l2 from '../../shared/cache/l2.cache';
import { complete, getPriceAt } from '../../shared/llm/llm.client';
import { buildSummaryPrompt } from './news.prompts';
import * as newsRepo from './news.repository';
import type { NewsQuery, NewsServiceResult, ArticleContext, PatternSummary, SimilarHistoricalEvent } from './news.types';

const L1_TTL_MS        = 60_000;  // 1 min
const L2_TTL_SEC       = 300;     // 5 min
const BREAKING_TTL_SEC = 120;     // 2 min

function cacheKey(params: NewsQuery): string {
  return `news:${params.asset ?? 'all'}:${params.limit}:${params.sentiment ?? ''}:${params.severity ?? ''}:${params.tier ?? ''}:${params.hours}:${params.query ?? ''}`;
}

async function generateSummary(params: Pick<NewsQuery, 'asset'>, articles: NewsServiceResult['articles']): Promise<string | undefined> {
  try {
    const res = await complete(buildSummaryPrompt(articles, params.asset), { temperature: 0.2, max_tokens: 256 });
    return res.content.trim();
  } catch {
    return undefined; // best-effort — never blocks the response
  }
}

export async function getNews(params: NewsQuery, withSummary = false): Promise<NewsServiceResult> {
  const start = Date.now();
  const key = cacheKey(params);

  const l1Hit = l1.get<NewsServiceResult>(key);
  if (l1Hit) return { ...l1Hit, cached: true, latency_ms: Date.now() - start };

  const l2Hit = await l2.get<NewsServiceResult>(key);
  if (l2Hit) {
    l1.set(key, l2Hit, L1_TTL_MS);
    return { ...l2Hit, cached: true, latency_ms: Date.now() - start };
  }

  const articles = await newsRepo.findMany(params);
  const summary  = withSummary && articles.length > 0 ? await generateSummary(params, articles) : undefined;

  const result: NewsServiceResult = { articles, summary, total: articles.length, cached: false, latency_ms: Date.now() - start };
  l1.set(key, result, L1_TTL_MS);
  await l2.set(key, result, L2_TTL_SEC);

  return result;
}

export async function getBreakingNews(limit = 20): Promise<NewsServiceResult> {
  const start = Date.now();
  const key = 'news:breaking';

  const l1Hit = l1.get<NewsServiceResult>(key);
  if (l1Hit) return { ...l1Hit, cached: true, latency_ms: Date.now() - start };

  const l2Hit = await l2.get<NewsServiceResult>(key);
  if (l2Hit) {
    l1.set(key, l2Hit, L1_TTL_MS);
    return { ...l2Hit, cached: true, latency_ms: Date.now() - start };
  }

  const articles = await newsRepo.findBreaking(limit);
  const result: NewsServiceResult = { articles, total: articles.length, cached: false, latency_ms: Date.now() - start };
  l1.set(key, result, L1_TTL_MS);
  await l2.set(key, result, BREAKING_TTL_SEC);

  return result;
}

export async function getArticleById(id: string): Promise<NewsServiceResult['articles'][0] | null> {
  return newsRepo.findById(id);
}

// ── Historical context ────────────────────────────────────────────────────────

function buildPatternSummary(events: SimilarHistoricalEvent[]): PatternSummary {
  const withPrice = events.filter(e => e.priceOutcome.change7dPct != null);
  const bullish7d = withPrice.filter(e => (e.priceOutcome.change7dPct ?? 0) > 0).length;
  const bearish7d = withPrice.filter(e => (e.priceOutcome.change7dPct ?? 0) < 0).length;

  const avg7d = withPrice.length > 0
    ? withPrice.reduce((s, e) => s + (e.priceOutcome.change7dPct ?? 0), 0) / withPrice.length
    : null;

  const with30d  = events.filter(e => e.priceOutcome.change30dPct != null);
  const avg30d = with30d.length > 0
    ? with30d.reduce((s, e) => s + (e.priceOutcome.change30dPct ?? 0), 0) / with30d.length
    : null;

  return {
    eventCount:        events.length,
    bullishOutcomes7d: bullish7d,
    bearishOutcomes7d: bearish7d,
    avgChange7dPct:    avg7d != null ? Math.round(avg7d * 100) / 100 : null,
    avgChange30dPct:   avg30d != null ? Math.round(avg30d * 100) / 100 : null,
  };
}

function buildContextSummary(events: SimilarHistoricalEvent[], pattern: PatternSummary): string {
  if (events.length === 0) {
    return 'No similar historical events found in the archive with sufficient similarity.';
  }

  const dominant = pattern.bearishOutcomes7d > pattern.bullishOutcomes7d ? 'bearish' : 'bullish';
  const majority = Math.max(pattern.bearishOutcomes7d, pattern.bullishOutcomes7d);

  const parts: string[] = [
    `${pattern.eventCount} similar historical event${pattern.eventCount > 1 ? 's' : ''} found (2017–2025).`,
  ];

  if (pattern.avgChange7dPct != null) {
    parts.push(
      `Price was ${dominant} in ${majority} of ${pattern.eventCount} cases 7 days after the event.` +
      ` Average 7-day price change: ${pattern.avgChange7dPct > 0 ? '+' : ''}${pattern.avgChange7dPct}%.`,
    );
  }

  if (pattern.avgChange30dPct != null) {
    parts.push(
      `Average 30-day price change: ${pattern.avgChange30dPct > 0 ? '+' : ''}${pattern.avgChange30dPct}%.`,
    );
  }

  parts.push('This is historical pattern data — not a prediction. Always apply your own judgement.');

  return parts.join(' ');
}

/**
 * Fetch an article and enrich it with historical price context.
 *
 * For each historically similar event found in finbot-history, we look up
 * what the price did 1d, 7d, and 30d after that event. This gives traders
 * data-driven context: "similar narratives historically led to X% moves."
 *
 * Price lookups run in parallel (Promise.allSettled) — one failing doesn't
 * block the others.
 *
 * Cached for 30 minutes — history doesn't change, price lookups are stable.
 */
export async function getArticleContext(id: string): Promise<ArticleContext | null> {
  const cacheKey = `news:context:${id}`;

  const cached = await l2.get<ArticleContext>(cacheKey);
  if (cached) return cached;

  const article = await newsRepo.findById(id);
  if (!article) return null;

  // Find similar past events using the article's title + summary as query text
  const text    = `${article.title}. ${article.summary}`;
  const similar = await newsRepo.findSimilarHistorical(text, 5, article.asset);

  // Fetch price outcomes for each similar event in parallel
  const withPrices: SimilarHistoricalEvent[] = await Promise.all(
    similar.map(async event => {
      try {
        const eventDate = event.publishedAt.split('T')[0]; // YYYY-MM-DD
        const prices    = await getPriceAt(event.asset, eventDate);
        return {
          ...event,
          priceOutcome: {
            priceAtEvent:  prices.price_at_event,
            price1dAfter:  prices.price_1d_after,
            price7dAfter:  prices.price_7d_after,
            price30dAfter: prices.price_30d_after,
            change1dPct:   prices.change_1d_pct,
            change7dPct:   prices.change_7d_pct,
            change30dPct:  prices.change_30d_pct,
          },
        };
      } catch {
        // Price lookup failed for this event — return nulls rather than dropping the event
        return {
          ...event,
          priceOutcome: {
            priceAtEvent:  null, price1dAfter: null, price7dAfter: null, price30dAfter: null,
            change1dPct:   null, change7dPct:  null, change30dPct: null,
          },
        };
      }
    }),
  );

  const patternSummary = buildPatternSummary(withPrices);
  const summary        = buildContextSummary(withPrices, patternSummary);

  const result: ArticleContext = {
    article,
    historicalContext: {
      similarEvents:  withPrices,
      patternSummary,
      summary,
    },
  };

  await l2.set(cacheKey, result, 30 * 60); // 30 min — history is stable
  return result;
}

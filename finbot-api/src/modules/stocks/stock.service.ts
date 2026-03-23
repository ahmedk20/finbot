/**
 * Stock service — orchestrates data fetching, caching, and AI summary generation.
 *
 * Key design decisions:
 *   1. getProfile() returns cached data immediately; background refresh if stale.
 *      This is "stale-while-revalidate" — never blocks the user on a cold FMP call.
 *
 *   2. getFullProfile() fetches all sections in parallel (Promise.all).
 *      Each section has independent cache — analysts don't bust financials cache, etc.
 *
 *   3. AI summary is fully non-blocking: if cached → return it; if not → return null
 *      and trigger generation in the background. Next request sees the result.
 *      This prevents a slow LLM call from blocking a time-sensitive price response.
 */

import {
  getFmpProfile, getFmpFinancials, getFmpAnalysts, getFmpOwnership, getFmpEarnings,
} from '../../shared/market/fmp.client';
import { getSnapshot as getPolySnapshot, getChart as getPolyChart } from '../../shared/market/polygon.client';
import { complete } from '../../shared/llm/llm.client';
import { logger }  from '../../shared/utils/logger';
import * as repo   from './stock.repository';
import { StockNotFoundError } from './stock.errors';
import type { FullStockProfileResponse, StockProfileResponse } from './stock.types';

// ── Profile (with stale-while-revalidate) ─────────────────────────────────────

export async function getProfile(ticker: string): Promise<StockProfileResponse> {
  const t = ticker.toUpperCase();
  const cached = await repo.getProfile(t);

  if (cached && !repo.isProfileStale(cached)) {
    // Fresh cache — return immediately, trigger AI summary if missing (background)
    if (!cached.aiSummary) {
      void generateAiSummary(t, cached).catch(err =>
        logger.warn(err, `AI summary generation failed for ${t}`),
      );
    }
    return toProfileResponse(cached);
  }

  // Cache miss or stale — fetch live data
  const [fmpData, snapData] = await Promise.all([
    getFmpProfile(t).catch(() => null),
    getPolySnapshot(t).catch(() => null),
  ]);

  if (!fmpData?.ticker && !snapData?.ticker) {
    // If no live data but we have a stale cache, return it with a warning
    if (cached) return toProfileResponse(cached);
    throw new StockNotFoundError(t);
  }

  const record = await repo.upsertProfile(t, {
    name:        fmpData?.name        ?? null,
    exchange:    fmpData?.exchange     ?? null,
    sector:      fmpData?.sector       ?? null,
    industry:    fmpData?.industry     ?? null,
    description: fmpData?.description  ?? null,
    ceo:         fmpData?.ceo          ?? null,
    employees:   fmpData?.employees    ?? null,
    website:     fmpData?.website      ?? null,
    country:     fmpData?.country      ?? null,
    ipoDate:     fmpData?.ipoDate      ?? null,
    currency:    fmpData?.currency     ?? null,
    isEtf:       fmpData?.isEtf        ?? null,
    price:       snapData?.price       ?? fmpData?.price       ?? null,
    change:      snapData?.change      ?? null,
    changePct:   snapData?.changePct   ?? null,
    marketCap:   fmpData?.marketCap    ?? null,
    pe:          fmpData?.pe           ?? null,
    eps:         fmpData?.eps          ?? null,
    beta:        fmpData?.beta         ?? null,
    weekHigh52:  fmpData?.weekHigh52   ?? null,
    weekLow52:   fmpData?.weekLow52    ?? null,
    avgVolume:   fmpData?.avgVolume    ?? null,
    dcfValue:    fmpData?.dcfValue     ?? null,
    aiSummary:   cached?.aiSummary     ?? null,
    aiSummaryAt: cached?.aiSummaryAt   ?? null,
  });

  // Trigger AI summary in background — non-blocking
  if (!record.aiSummary) {
    void generateAiSummary(t, record).catch(err =>
      logger.warn(err, `AI summary generation failed for ${t}`),
    );
  }

  return toProfileResponse(record);
}

// ── Full profile — all sections in parallel ────────────────────────────────────

export async function getFullProfile(
  ticker: string,
  range = '1M',
): Promise<FullStockProfileResponse> {
  const t = ticker.toUpperCase();

  // Run all fetches concurrently — independent caches, independent failures
  const [profile, financials, analysts, ownership, earnings, chart] = await Promise.all([
    getProfile(t),
    getFinancials(t).catch(() => null),
    getAnalysts(t).catch(() => null),
    getOwnership(t).catch(() => null),
    // Earnings not cached in DB — always live (small payload, called infrequently)
    getFmpEarnings(t).catch(() => null),
    getPolyChart(t, range).catch(() => null),
  ]);

  return { profile, financials, analysts, ownership, earnings, chart };
}

// ── Individual sections ───────────────────────────────────────────────────────

export async function getFinancials(ticker: string, period: 'quarter' | 'annual' = 'quarter') {
  const t = ticker.toUpperCase();
  const cached = await repo.getFinancials(t);
  if (cached) return cached;

  const data = await getFmpFinancials(t, period);
  if (!data) return null;

  await repo.upsertFinancials(t, period, {
    incomeStatement: data.incomeStatement,
    balanceSheet:    data.balanceSheet,
    cashFlow:        data.cashFlow,
  });

  return data;
}

export async function getAnalysts(ticker: string) {
  const t = ticker.toUpperCase();
  const cached = await repo.getAnalysts(t);
  if (cached) return cached;

  const data = await getFmpAnalysts(t);
  if (!data) return null;

  await repo.upsertAnalysts(t, {
    grades:               data.grades,
    priceTargetConsensus: data.priceTargetConsensus,
  });

  return data;
}

export async function getOwnership(ticker: string) {
  const t = ticker.toUpperCase();
  const cached = await repo.getOwnership(t);
  if (cached) return cached;

  const data = await getFmpOwnership(t);
  if (!data) return null;

  await repo.upsertOwnership(t, {
    institutional: data.institutional,
    etfs:          data.etfs,
  });

  return data;
}

export async function getChart(ticker: string, range = '1M') {
  // Charts are not cached in DB — they're large and change continuously.
  // L2 (Redis) caching happens at the trading-agents level via Polygon's own CDN.
  return getPolyChart(ticker.toUpperCase(), range);
}

// ── AI summary ────────────────────────────────────────────────────────────────

async function generateAiSummary(
  ticker: string,
  profile: { name?: string | null; sector?: string | null; description?: string | null; pe?: number | null; marketCap?: number | null },
): Promise<void> {
  const prompt = `You are a concise financial analyst. Write a 3-sentence summary of ${ticker} (${profile.name ?? ticker}).
Sector: ${profile.sector ?? 'unknown'}. Market cap: ${profile.marketCap ? `$${(profile.marketCap / 1e9).toFixed(1)}B` : 'unknown'}.
P/E: ${profile.pe ?? 'N/A'}.
Description: ${profile.description?.slice(0, 500) ?? 'not available'}.
Be factual, neutral, and concise. Do not include disclaimers.`;

  const result = await complete(
    [{ role: 'user', content: prompt }],
    { max_tokens: 200, temperature: 0.2 },
  );

  await repo.updateAiSummary(ticker, result.content.trim());
}

// ── Shape helper ──────────────────────────────────────────────────────────────

function toProfileResponse(r: Awaited<ReturnType<typeof repo.getProfile>>): StockProfileResponse {
  if (!r) throw new Error('unreachable');
  return {
    ticker:      r.ticker,
    name:        r.name,
    exchange:    r.exchange,
    sector:      r.sector,
    industry:    r.industry,
    description: r.description,
    ceo:         r.ceo,
    employees:   r.employees,
    website:     r.website,
    country:     r.country,
    ipoDate:     r.ipoDate,
    currency:    r.currency,
    isEtf:       r.isEtf,
    price:       r.price,
    change:      r.change,
    changePct:   r.changePct,
    marketCap:   r.marketCap,
    pe:          r.pe,
    eps:         r.eps,
    beta:        r.beta,
    weekHigh52:  r.weekHigh52,
    weekLow52:   r.weekLow52,
    avgVolume:   r.avgVolume,
    dcfValue:    r.dcfValue,
    aiSummary:   r.aiSummary,
    cachedAt:    r.updatedAt,
  };
}

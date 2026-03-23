/**
 * Massive (formerly Polygon.io) market data client.
 * Called directly from finbot-api — no hop through trading-agents.
 * MASSIVE_API_KEY lives in finbot-api env and never reaches the client.
 *
 * Endpoints are identical to Polygon.io — only base URL and auth changed.
 * Auth: Authorization: Bearer <key>  (also supports ?apiKey= query param)
 */

import { env }    from '../config/env';
import { logger } from '../utils/logger';

const MASSIVE_BASE = 'https://api.massive.com';

async function polyGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(`${MASSIVE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res  = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${env.MASSIVE_API_KEY}` },
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) { logger.warn(`Massive ${path} returned ${res.status}`); return null; }
    const data = await res.json() as Record<string, unknown>;
    if (data['status'] === 'NOT_FOUND' || data['status'] === 'ERROR') {
      logger.warn({ path }, `Massive error: ${data['error'] ?? data['message']}`);
      return null;
    }
    return data as T;
  } catch (err) {
    logger.error(err, `Massive request failed: ${path}`);
    return null;
  }
}

// ── Typed responses ────────────────────────────────────────────────────────────

export interface PolySnapshotResponse {
  ticker: string; price?: number; change?: number; changePct?: number;
  open?: number; high?: number; low?: number; volume?: number;
  vwap?: number; prevClose?: number; lastUpdated?: number;
}

export interface PolyCandle {
  timestamp: number; open: number; high: number; low: number;
  close: number; volume: number; vwap?: number;
}

export interface PolyChartResponse {
  ticker: string; range: string; timespan: string; multiplier: number;
  candles: PolyCandle[]; count: number;
}

// ── Range → candle size mapping ────────────────────────────────────────────────

function rangeToParams(range: string): { multiplier: number; timespan: string; fromDate: string } {
  const today = new Date();
  const ago   = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const map: Record<string, { multiplier: number; timespan: string; fromDate: string }> = {
    '1D':  { multiplier: 5,  timespan: 'minute', fromDate: ago(1) },
    '1W':  { multiplier: 1,  timespan: 'hour',   fromDate: ago(7) },
    '1M':  { multiplier: 1,  timespan: 'day',    fromDate: ago(30) },
    '3M':  { multiplier: 1,  timespan: 'day',    fromDate: ago(90) },
    '6M':  { multiplier: 1,  timespan: 'day',    fromDate: ago(180) },
    'YTD': { multiplier: 1,  timespan: 'day',    fromDate: `${today.getFullYear()}-01-01` },
    '1Y':  { multiplier: 1,  timespan: 'day',    fromDate: ago(365) },
    '5Y':  { multiplier: 1,  timespan: 'week',   fromDate: ago(365 * 5) },
    '10Y': { multiplier: 1,  timespan: 'month',  fromDate: ago(365 * 10) },
    'ALL': { multiplier: 1,  timespan: 'month',  fromDate: '1980-01-01' },
  };
  return map[range] ?? map['1M'];
}

// ── Public functions ───────────────────────────────────────────────────────────

export async function getSnapshot(ticker: string): Promise<PolySnapshotResponse | null> {
  const data = await polyGet<Record<string, unknown>>(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
  );
  if (!data || !data['ticker']) return null;

  const snap = data['ticker'] as Record<string, unknown>;
  const day  = (snap['day']     ?? {}) as Record<string, number>;
  const prev = (snap['prevDay'] ?? {}) as Record<string, number>;
  const min_ = (snap['min']     ?? {}) as Record<string, number>;

  return {
    ticker:      snap['ticker']           as string,
    price:       (snap['lastTrade'] as Record<string, number> | undefined)?.['p'] ?? min_['c'],
    change:      snap['todaysChange']     as number | undefined,
    changePct:   snap['todaysChangePerc'] as number | undefined,
    open:        day['o'],
    high:        day['h'],
    low:         day['l'],
    volume:      day['v'],
    vwap:        day['vw'],
    prevClose:   prev['c'],
    lastUpdated: snap['updated']          as number | undefined,
  };
}

export async function getChart(ticker: string, range = '1M'): Promise<PolyChartResponse | null> {
  const { multiplier, timespan, fromDate } = rangeToParams(range);
  const toDate = new Date().toISOString().slice(0, 10);

  const data = await polyGet<Record<string, unknown>>(
    `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}`,
    { adjusted: 'true', sort: 'asc', limit: '50000' },
  );
  if (!data) return null;

  const results = (data['results'] as Record<string, number>[] | undefined) ?? [];
  return {
    ticker,
    range,
    timespan,
    multiplier,
    candles: results.map(r => ({
      timestamp: r['t'],
      open:      r['o'],
      high:      r['h'],
      low:       r['l'],
      close:     r['c'],
      volume:    r['v'],
      vwap:      r['vw'],
    })),
    count: results.length,
  };
}

/**
 * Historical price lookup — CoinGecko (free tier, no key required)
 *
 * Fetches daily OHLCV for a given asset over a date range and returns
 * a lookup map: { "YYYY-MM-DD" → closePrice }.
 *
 * Used by the signal engine (Phase 4) to attach priceMove24h / priceMove72h
 * to historical articles — e.g. "BTC was +8% in the 24h after this article".
 *
 * Free tier limits:
 *  - 30 req/min (0.5 req/s)
 *  - /coins/{id}/market_chart/range → up to 90 days per call
 *
 * Usage:
 *   const prices = await fetchPriceRange('bitcoin', '2021-01-01', '2021-03-31');
 *   const close  = prices['2021-01-05']; // → 33900.12
 *
 * To attach to bootstrap articles:
 *   const move24h = getPriceMove(prices, articleDate, 1);
 *   const move72h = getPriceMove(prices, articleDate, 3);
 */

import pino from 'pino';
import { fetchJSON } from '../lib/fetcher';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

const CG_BASE = 'https://api.coingecko.com/api/v3';

// ─── CoinGecko asset ID mapping ───────────────────────────────────────────────
// Ticker → CoinGecko ID (add more as needed)

export const TICKER_TO_CG_ID: Record<string, string> = {
  BTC:   'bitcoin',
  ETH:   'ethereum',
  SOL:   'solana',
  BNB:   'binancecoin',
  XRP:   'ripple',
  ADA:   'cardano',
  AVAX:  'avalanche-2',
  DOT:   'polkadot',
  MATIC: 'matic-network',
  LINK:  'chainlink',
  UNI:   'uniswap',
  ATOM:  'cosmos',
  LTC:   'litecoin',
  XMR:   'monero',
  DOGE:  'dogecoin',
  SHIB:  'shiba-inu',
  FTM:   'fantom',
  NEAR:  'near',
  ALGO:  'algorand',
  ZEC:   'zcash',
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** Date string "YYYY-MM-DD" → closing price that day */
export type PriceLookup = Record<string, number>;

interface CgMarketChartResponse {
  prices: [number, number][];   // [timestamp_ms, price]
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch daily closing prices for a CoinGecko coin ID between two ISO date strings.
 * Splits ranges > 90 days into multiple requests (CoinGecko free tier limit).
 *
 * @param cgId      CoinGecko coin ID — e.g. "bitcoin"
 * @param fromDate  ISO date "YYYY-MM-DD"
 * @param toDate    ISO date "YYYY-MM-DD"
 */
export async function fetchPriceRange(
  cgId:     string,
  fromDate: string,
  toDate:   string,
): Promise<PriceLookup> {
  const lookup: PriceLookup = {};

  const from  = new Date(fromDate);
  const to    = new Date(toDate);
  const cursor = new Date(from);

  // Split into 90-day windows to stay within free tier
  while (cursor < to) {
    const windowEnd = new Date(cursor);
    windowEnd.setDate(windowEnd.getDate() + 89);
    if (windowEnd > to) windowEnd.setTime(to.getTime());

    const fromUnix = Math.floor(cursor.getTime() / 1_000);
    const toUnix   = Math.floor(windowEnd.getTime() / 1_000);

    const url = `${CG_BASE}/coins/${cgId}/market_chart/range?vs_currency=usd&from=${fromUnix}&to=${toUnix}`;

    try {
      const data = await fetchJSON<CgMarketChartResponse>(url, { timeout: 15_000 });

      for (const [tsMs, price] of data.prices) {
        const dateKey = new Date(tsMs).toISOString().slice(0, 10); // "YYYY-MM-DD"
        lookup[dateKey] = price;
      }

      logger.debug(
        { cgId, from: cursor.toISOString().slice(0, 10), to: windowEnd.toISOString().slice(0, 10) },
        'Price window fetched',
      );
    } catch (err) {
      logger.warn({ cgId, err: (err as Error).message }, 'Price fetch window failed — skipping');
    }

    // Advance cursor + 2s sleep to respect 30 req/min rate limit
    cursor.setDate(cursor.getDate() + 90);
    await new Promise(r => setTimeout(r, 2_000));
  }

  return lookup;
}

// ─── Price move calculator ─────────────────────────────────────────────────────

/**
 * Calculate % price change N days after a given article date.
 *
 * @param lookup      PriceLookup map from fetchPriceRange
 * @param articleDate ISO date string of the article
 * @param daysAfter   1 = 24h move, 3 = 72h move
 * @returns           percentage change, e.g. 8.3 or -4.1 — null if data unavailable
 */
export function getPriceMove(
  lookup:      PriceLookup,
  articleDate: string,
  daysAfter:   number,
): number | null {
  const base   = lookup[articleDate];
  if (!base) return null;

  const targetDate = new Date(articleDate);
  targetDate.setDate(targetDate.getDate() + daysAfter);
  const targetKey = targetDate.toISOString().slice(0, 10);

  const target = lookup[targetKey];
  if (!target) return null;

  return Math.round(((target - base) / base) * 10_000) / 100; // 2 decimal places
}

// ─── Ticker convenience wrapper ────────────────────────────────────────────────

/**
 * Fetch price range by ticker symbol instead of CoinGecko ID.
 * Returns empty lookup if ticker isn't in TICKER_TO_CG_ID.
 */
export async function fetchPriceRangeByTicker(
  ticker:   string,
  fromDate: string,
  toDate:   string,
): Promise<PriceLookup> {
  const cgId = TICKER_TO_CG_ID[ticker.toUpperCase()];
  if (!cgId) {
    logger.warn({ ticker }, 'No CoinGecko ID for ticker — skipping price fetch');
    return {};
  }
  return fetchPriceRange(cgId, fromDate, toDate);
}

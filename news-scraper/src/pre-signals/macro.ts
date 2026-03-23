/**
 * Macro Context Pre-Signal — Yahoo Finance (unofficial API, no key required)
 *
 * Adapted from crypto-vision (github.com/nirholas/crypto-vision).
 *
 * Provides: S&P 500, NASDAQ, VIX, DXY, Gold, Oil, 10Y Treasury Yield.
 *
 * Why this matters for crypto signals:
 *  - DXY rising   → USD strength → BTC/ETH selling pressure
 *  - VIX spiking  → risk-off sentiment → crypto sell-off
 *  - SPX falling  → correlation with crypto in risk-off regimes
 *  - TNX rising   → higher yields → capital flows out of risk assets
 *  - Gold rising  → safe-haven demand → mixed for crypto (store of value narrative)
 *
 * All symbols are fetched from Yahoo Finance's chart endpoint.
 * Free, no auth, no rate limits beyond reasonable use.
 */

import { fetchJSON } from '../lib/fetcher';

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ─── Symbols ──────────────────────────────────────────────────────────────────

const SYMBOLS = {
  SPX:    { symbol: '^GSPC',    name: 'S&P 500'               },
  NASDAQ: { symbol: '^IXIC',    name: 'NASDAQ Composite'       },
  VIX:    { symbol: '^VIX',     name: 'CBOE Volatility Index'  },
  DXY:    { symbol: 'DX-Y.NYB', name: 'US Dollar Index'        },
  GOLD:   { symbol: 'GC=F',     name: 'Gold Futures'           },
  OIL:    { symbol: 'CL=F',     name: 'Crude Oil (WTI)'        },
  TNX:    { symbol: '^TNX',     name: '10-Year Treasury Yield' },
  TYX:    { symbol: '^TYX',     name: '30-Year Treasury Yield' },
} as const;

type SymbolKey = keyof typeof SYMBOLS;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MacroQuote {
  key:           SymbolKey;
  name:          string;
  price:         number;
  previousClose: number;
  change:        number;       // absolute
  changePercent: number;       // percentage, e.g. -1.23
  timestamp:     number;       // unix ms
}

export interface MacroSnapshot {
  spx:    MacroQuote | null;
  nasdaq: MacroQuote | null;
  vix:    MacroQuote | null;   // > 30 = fear, > 40 = extreme fear
  dxy:    MacroQuote | null;   // rising = USD strength = crypto pressure
  gold:   MacroQuote | null;
  oil:    MacroQuote | null;
  tnx:    MacroQuote | null;   // 10Y yield
  tyx:    MacroQuote | null;   // 30Y yield
}

// ─── Core fetcher (adapted from crypto-vision macro.ts) ───────────────────────

async function fetchSymbol(key: SymbolKey): Promise<MacroQuote | null> {
  const { symbol, name } = SYMBOLS[key];
  try {
    const data = await fetchJSON<Record<string, unknown>>(
      `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { timeout: 8_000 },
    );

    const result = (
      (data.chart as Record<string, unknown>)?.result as Record<string, unknown>[]
    )?.[0];
    if (!result) return null;

    const meta      = result.meta      as Record<string, unknown> | undefined;
    const quotes    = (
      (result.indicators as Record<string, unknown>)?.quote as Record<string, unknown>[]
    )?.[0];
    const timestamps = result.timestamp as number[] | undefined;

    if (!meta || !quotes || !timestamps) return null;

    const lastIdx  = timestamps.length - 1;
    const prevIdx  = Math.max(0, lastIdx - 1);
    const closeArr = quotes.close as number[] | undefined;

    const price     = (meta.regularMarketPrice as number) || closeArr?.[lastIdx] || 0;
    const prevClose = closeArr?.[prevIdx] || (meta.previousClose as number) || price;
    const change    = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    return {
      key,
      name,
      price:         Math.round(price       * 100) / 100,
      previousClose: Math.round(prevClose   * 100) / 100,
      change:        Math.round(change      * 100) / 100,
      changePercent: Math.round(changePct   * 100) / 100,
      timestamp:     (timestamps[lastIdx] || 0) * 1_000,
    };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all macro indicators in parallel.
 * Individual failures return null — never crashes the full snapshot.
 */
export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const [spx, nasdaq, vix, dxy, gold, oil, tnx, tyx] = await Promise.all([
    fetchSymbol('SPX'),
    fetchSymbol('NASDAQ'),
    fetchSymbol('VIX'),
    fetchSymbol('DXY'),
    fetchSymbol('GOLD'),
    fetchSymbol('OIL'),
    fetchSymbol('TNX'),
    fetchSymbol('TYX'),
  ]);

  return { spx, nasdaq, vix, dxy, gold, oil, tnx, tyx };
}

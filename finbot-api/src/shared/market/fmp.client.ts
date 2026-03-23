/**
 * Financial Modeling Prep (FMP) client.
 * Called directly from finbot-api — no hop through trading-agents.
 * FMP_API_KEY lives in finbot-api env and never reaches the client.
 *
 * FMP free tier: 250 req/day. Paid tiers: 300–unlimited.
 * Data freshness: profiles daily, financials quarterly.
 */

import { env }    from '../config/env';
import { logger } from '../utils/logger';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_V4   = 'https://financialmodelingprep.com/api/v4';

async function fmpGet<T>(path: string, params: Record<string, string> = {}, base = FMP_BASE): Promise<T | null> {
  const url = new URL(`${base}${path}`);
  url.searchParams.set('apikey', env.FMP_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { logger.warn(`FMP ${path} returned ${res.status}`); return null; }
    const data = await res.json() as T;
    // FMP returns { "Error Message": "..." } on bad ticker or key
    if (data && typeof data === 'object' && 'Error Message' in (data as object)) {
      logger.warn({ path }, `FMP error: ${(data as Record<string, string>)['Error Message']}`);
      return null;
    }
    return data;
  } catch (err) {
    logger.error(err, `FMP request failed: ${path}`);
    return null;
  }
}

// ── Typed responses ────────────────────────────────────────────────────────────

export interface FmpProfileResponse {
  ticker?: string; name?: string; exchange?: string; sector?: string; industry?: string;
  description?: string; ceo?: string; employees?: number; website?: string;
  country?: string; ipoDate?: string; currency?: string;
  price?: number; marketCap?: number; pe?: number; eps?: number; beta?: number;
  weekHigh52?: number; weekLow52?: number; dividendYield?: number;
  outstandingShares?: number; avgVolume?: number; dcfValue?: number;
  isEtf?: boolean; isActivelyTrading?: boolean;
}

export interface FmpFinancialsResponse {
  period: string;
  incomeStatement: unknown[];
  balanceSheet: unknown[];
  cashFlow: unknown[];
}

export interface FmpAnalystsResponse {
  grades: unknown[];
  priceTargetConsensus: { high?: number; low?: number; median?: number; mean?: number };
}

export interface FmpOwnershipResponse {
  institutional: unknown[];
  etfs: unknown[];
}

export interface FmpEarningsResponse {
  nextEarningsDate?: string;
  history: unknown[];
}

// ── Public functions ───────────────────────────────────────────────────────────

export async function getFmpProfile(ticker: string): Promise<FmpProfileResponse | null> {
  const data = await fmpGet<unknown[]>(`/profile/${ticker}`);
  if (!data || !data[0]) return null;
  const p = data[0] as Record<string, unknown>;
  return {
    ticker:           p['symbol']                as string  | undefined,
    name:             p['companyName']           as string  | undefined,
    exchange:         p['exchangeShortName']     as string  | undefined,
    sector:           p['sector']               as string  | undefined,
    industry:         p['industry']             as string  | undefined,
    description:      p['description']          as string  | undefined,
    ceo:              p['ceo']                  as string  | undefined,
    employees:        p['fullTimeEmployees']     as number  | undefined,
    website:          p['website']              as string  | undefined,
    country:          p['country']              as string  | undefined,
    ipoDate:          p['ipoDate']              as string  | undefined,
    currency:         p['currency']             as string  | undefined,
    price:            p['price']                as number  | undefined,
    marketCap:        p['mktCap']               as number  | undefined,
    pe:               p['pe']                   as number  | undefined,
    eps:              p['eps']                  as number  | undefined,
    beta:             p['beta']                 as number  | undefined,
    weekHigh52:       p['52WeekHigh']           as number  | undefined,
    weekLow52:        p['52WeekLow']            as number  | undefined,
    dividendYield:    p['lastDiv']              as number  | undefined,
    outstandingShares:p['sharesOutstanding']    as number  | undefined,
    avgVolume:        p['volAvg']               as number  | undefined,
    dcfValue:         p['dcf']                  as number  | undefined,
    isEtf:            p['isEtf']                as boolean | undefined,
    isActivelyTrading:p['isActivelyTrading']    as boolean | undefined,
  };
}

export async function getFmpFinancials(
  ticker: string,
  period: 'quarter' | 'annual' = 'quarter',
): Promise<FmpFinancialsResponse | null> {
  const [income, balance, cashflow] = await Promise.all([
    fmpGet<unknown[]>(`/income-statement/${ticker}`,    { period, limit: '5' }),
    fmpGet<unknown[]>(`/balance-sheet-statement/${ticker}`, { period, limit: '5' }),
    fmpGet<unknown[]>(`/cash-flow-statement/${ticker}`, { period, limit: '5' }),
  ]);

  return {
    period,
    incomeStatement: income    ?? [],
    balanceSheet:    balance   ?? [],
    cashFlow:        cashflow  ?? [],
  };
}

export async function getFmpAnalysts(ticker: string): Promise<FmpAnalystsResponse | null> {
  const [grades, targets] = await Promise.all([
    fmpGet<unknown[]>(`/grade/${ticker}`, { limit: '20' }),
    fmpGet<unknown[]>(`/price-target-consensus/${ticker}`),
  ]);

  const c = Array.isArray(targets) && targets[0] ? targets[0] as Record<string, unknown> : {};
  return {
    grades: grades ?? [],
    priceTargetConsensus: {
      high:   c['targetHigh']   as number | undefined,
      low:    c['targetLow']    as number | undefined,
      median: c['targetMedian'] as number | undefined,
      mean:   c['targetMean']   as number | undefined,
    },
  };
}

export async function getFmpOwnership(ticker: string): Promise<FmpOwnershipResponse | null> {
  const [institutional, etfs] = await Promise.all([
    fmpGet<unknown[]>(`/institutional-holder/${ticker}`),
    fmpGet<unknown[]>(`/etf-holder/${ticker}`),
  ]);
  return {
    institutional: (institutional ?? []).slice(0, 10),
    etfs:          (etfs          ?? []).slice(0, 10),
  };
}

export async function getFmpEarnings(ticker: string): Promise<FmpEarningsResponse | null> {
  const [historical, calendar] = await Promise.all([
    fmpGet<unknown[]>(`/historical/earning_calendar/${ticker}`, { limit: '4' }),
    fmpGet<unknown[]>(`/earning_calendar`, { symbol: ticker }),
  ]);

  const upcoming = (calendar ?? []).filter(
    (e) => (e as Record<string, unknown>)['eps'] == null,
  );
  return {
    nextEarningsDate: upcoming[0] ? (upcoming[0] as Record<string, unknown>)['date'] as string : undefined,
    history: historical ?? [],
  };
}

export async function getFmpSegments(ticker: string) {
  const [product, geo] = await Promise.all([
    fmpGet<unknown>(`/revenue-product-segmentation`, { symbol: ticker, period: 'quarter' }, FMP_V4),
    fmpGet<unknown>(`/revenue-geographic-segmentation`, { symbol: ticker, period: 'quarter' }, FMP_V4),
  ]);
  return { byProduct: product ?? [], byGeography: geo ?? [] };
}

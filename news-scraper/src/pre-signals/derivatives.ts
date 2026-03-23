/**
 * Derivatives & Futures pre-signals — funding rates, open interest, liquidations.
 * Sources: Coinglass (freemium), Bybit (free), OKX (free), Deribit (free), Hyperliquid (free).
 * Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 */

import { coinglass, deribit, bybit, okx } from './adapters';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FundingRate {
  exchange:        string;
  symbol:          string;
  rate:            number;
  annualized:      number; // rate * 3 * 365 * 100
  nextFundingTime: number;
  timestamp:       number;
}

export interface OpenInterest {
  exchange:             string;
  symbol:               string;
  openInterest:         number; // USD
  openInterestChange24h: number;
  timestamp:            number;
}

export interface LiquidationSummary {
  symbol:               string;
  longLiquidations24h:  number;
  shortLiquidations24h: number;
  totalLiquidations24h: number;
  longShortRatio:       number;
}

export interface LongShortRatio {
  exchange:       string;
  symbol:         string;
  longAccount:    number;
  shortAccount:   number;
  longShortRatio: number;
  timestamp:      number;
}

export interface PerpMarket {
  exchange:         string;
  symbol:           string;
  markPrice:        number;
  indexPrice:       number;
  basis:            number;
  basisPercentage:  number;
  fundingRate:      number;
  openInterest:     number;
  volume24h:        number;
}

// ─── Coinglass ────────────────────────────────────────────────────────────────

export async function getAggregatedFundingRates(symbol = 'BTC'): Promise<FundingRate[]> {
  try {
    const data = await coinglass.fetch<{ data: any[] }>('/funding', { symbol });
    return (data.data || []).map((item: any) => ({
      exchange:        item.exchangeName || '',
      symbol:          item.symbol || symbol,
      rate:            item.rate || 0,
      annualized:      (item.rate || 0) * 3 * 365 * 100,
      nextFundingTime: item.nextFundingTime || 0,
      timestamp:       Date.now(),
    }));
  } catch {
    return [];
  }
}

export async function getAggregatedOpenInterest(symbol = 'BTC'): Promise<OpenInterest[]> {
  try {
    const data = await coinglass.fetch<{ data: any[] }>('/open_interest', { symbol });
    return (data.data || []).map((item: any) => ({
      exchange:              item.exchangeName || '',
      symbol:                item.symbol || symbol,
      openInterest:          item.openInterest || 0,
      openInterestChange24h: item.openInterestChange24h || 0,
      timestamp:             Date.now(),
    }));
  } catch {
    return [];
  }
}

export async function getLiquidations(symbol = 'BTC'): Promise<LiquidationSummary> {
  try {
    const data = await coinglass.fetch<{ data: any }>('/liquidation', { symbol });
    const d = data.data || {};
    return {
      symbol,
      longLiquidations24h:  d.longLiquidationUsd  || 0,
      shortLiquidations24h: d.shortLiquidationUsd || 0,
      totalLiquidations24h: (d.longLiquidationUsd || 0) + (d.shortLiquidationUsd || 0),
      longShortRatio:
        d.longLiquidationUsd && d.shortLiquidationUsd
          ? d.longLiquidationUsd / d.shortLiquidationUsd
          : 1,
    };
  } catch {
    return { symbol, longLiquidations24h: 0, shortLiquidations24h: 0, totalLiquidations24h: 0, longShortRatio: 1 };
  }
}

export async function getLongShortRatio(symbol = 'BTC'): Promise<LongShortRatio[]> {
  try {
    const data = await coinglass.fetch<{ data: any[] }>('/long_short', { symbol });
    return (data.data || []).map((item: any) => ({
      exchange:       item.exchangeName || '',
      symbol,
      longAccount:    item.longAccount    || 0,
      shortAccount:   item.shortAccount   || 0,
      longShortRatio: item.longShortRatio || 1,
      timestamp:      Date.now(),
    }));
  } catch {
    return [];
  }
}

// ─── Deribit ──────────────────────────────────────────────────────────────────

export async function getDeribitIndex(currency: 'BTC' | 'ETH' = 'BTC'): Promise<{
  indexPrice: number;
  estimatedDeliveryPrice: number;
}> {
  try {
    const data = await deribit.fetch<{
      result: { index_price: number; estimated_delivery_price: number };
    }>(`/get_index_price?index_name=${currency.toLowerCase()}_usd`);
    return {
      indexPrice:             data.result.index_price,
      estimatedDeliveryPrice: data.result.estimated_delivery_price,
    };
  } catch {
    return { indexPrice: 0, estimatedDeliveryPrice: 0 };
  }
}

export async function getVolatilityIndex(currency: 'BTC' | 'ETH' = 'BTC'): Promise<{
  volatility: number;
  timestamp:  number;
}> {
  try {
    const now = Date.now();
    const data = await deribit.fetch<{ result: { volatility: number } }>(
      `/get_volatility_index_data?currency=${currency}&resolution=3600&start_timestamp=${now - 3_600_000}&end_timestamp=${now}`,
    );
    return { volatility: data.result?.volatility || 0, timestamp: now };
  } catch {
    return { volatility: 0, timestamp: Date.now() };
  }
}

// ─── Bybit ────────────────────────────────────────────────────────────────────

export async function getBybitFundingHistory(symbol: string, limit = 20): Promise<FundingRate[]> {
  try {
    const data = await bybit.fetch<{ result: { list: any[] } }>('/market/funding/history', {
      category: 'linear',
      symbol:   `${symbol}USDT`,
      limit:    String(limit),
    });
    return (data.result?.list || []).map((f: any) => ({
      exchange:        'bybit',
      symbol:          f.symbol,
      rate:            parseFloat(f.fundingRate) || 0,
      annualized:      (parseFloat(f.fundingRate) || 0) * 3 * 365 * 100,
      nextFundingTime: 0,
      timestamp:       parseInt(f.fundingRateTimestamp) || Date.now(),
    }));
  } catch {
    return [];
  }
}

// ─── OKX ─────────────────────────────────────────────────────────────────────

export async function getOKXFundingRate(instId = 'BTC-USDT-SWAP'): Promise<FundingRate | null> {
  try {
    const data = await okx.fetch<{ data: any[] }>('/public/funding-rate', { instId });
    const d = data.data?.[0] || {};
    return {
      exchange:        'okx',
      symbol:          instId,
      rate:            parseFloat(d.fundingRate) || 0,
      annualized:      (parseFloat(d.fundingRate) || 0) * 3 * 365 * 100,
      nextFundingTime: parseInt(d.nextFundingTime) || 0,
      timestamp:       parseInt(d.fundingTime) || Date.now(),
    };
  } catch {
    return null;
  }
}

// ─── Hyperliquid (no API key needed) ─────────────────────────────────────────

export async function getHyperliquidMarkets(): Promise<PerpMarket[]> {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!response.ok) return [];

    const data = await response.json() as any[];
    const meta = data?.[0]?.universe || [];
    const ctxs = data?.[1]           || [];

    return meta.map((m: any, i: number) => {
      const ctx = ctxs[i] || {};
      const markPrice  = parseFloat(ctx.markPx)   || 0;
      const indexPrice = parseFloat(ctx.oraclePx) || 0;
      return {
        exchange:        'hyperliquid',
        symbol:          m.name,
        markPrice,
        indexPrice,
        basis:           markPrice - indexPrice,
        basisPercentage: indexPrice > 0 ? ((markPrice - indexPrice) / indexPrice) * 100 : 0,
        fundingRate:     parseFloat(ctx.funding)       || 0,
        openInterest:    parseFloat(ctx.openInterest)  || 0,
        volume24h:       parseFloat(ctx.dayNtlVlm)     || 0,
      };
    });
  } catch {
    return [];
  }
}

// ─── Aggregated snapshot ──────────────────────────────────────────────────────

/**
 * Cross-exchange funding rate summary for a symbol.
 * Returns average rate + directional sentiment signal.
 */
export async function getFundingSnapshot(symbol = 'BTC'): Promise<{
  aggregated: FundingRate[];
  bybit:      FundingRate[];
  okx:        FundingRate | null;
  average:    number;
  sentiment:  'bullish' | 'bearish' | 'neutral';
}> {
  const [aggregated, bybitRates, okxRate] = await Promise.allSettled([
    getAggregatedFundingRates(symbol),
    getBybitFundingHistory(symbol, 5),
    getOKXFundingRate(`${symbol}-USDT-SWAP`),
  ]);

  const allRates = [
    ...(aggregated.status === 'fulfilled' ? aggregated.value : []),
    ...(bybitRates.status === 'fulfilled' ? bybitRates.value : []),
  ];
  const avg = allRates.length > 0
    ? allRates.reduce((sum, r) => sum + r.rate, 0) / allRates.length
    : 0;

  return {
    aggregated: aggregated.status === 'fulfilled' ? aggregated.value : [],
    bybit:      bybitRates.status === 'fulfilled' ? bybitRates.value : [],
    okx:        okxRate.status    === 'fulfilled' ? okxRate.value    : null,
    average:    avg,
    sentiment:  avg > 0.0001 ? 'bullish' : avg < -0.0001 ? 'bearish' : 'neutral',
  };
}

/**
 * Full derivatives snapshot — funding, OI, liquidations, long/short ratio.
 */
export async function getDerivativesSnapshot(symbol = 'BTC'): Promise<{
  funding:        FundingRate[];
  openInterest:   OpenInterest[];
  liquidations:   LiquidationSummary;
  longShortRatio: LongShortRatio[];
  deribitIndex:   { indexPrice: number; estimatedDeliveryPrice: number } | null;
  volatility:     { volatility: number; timestamp: number } | null;
}> {
  const [funding, oi, liqs, lsr, dIdx, vol] = await Promise.allSettled([
    getAggregatedFundingRates(symbol),
    getAggregatedOpenInterest(symbol),
    getLiquidations(symbol),
    getLongShortRatio(symbol),
    getDeribitIndex(symbol as 'BTC' | 'ETH'),
    getVolatilityIndex(symbol as 'BTC' | 'ETH'),
  ]);

  return {
    funding:        funding.status      === 'fulfilled' ? funding.value      : [],
    openInterest:   oi.status           === 'fulfilled' ? oi.value           : [],
    liquidations:   liqs.status         === 'fulfilled' ? liqs.value
      : { symbol, longLiquidations24h: 0, shortLiquidations24h: 0, totalLiquidations24h: 0, longShortRatio: 1 },
    longShortRatio: lsr.status          === 'fulfilled' ? lsr.value          : [],
    deribitIndex:   dIdx.status         === 'fulfilled' ? dIdx.value         : null,
    volatility:     vol.status          === 'fulfilled' ? vol.value          : null,
  };
}

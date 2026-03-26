import { Agent, type Dispatcher } from 'undici';
import { env } from '../config/env';
import { CircuitBreaker } from '../utils/circuitBreaker';
import { LLMError } from '../utils/errors';

// Default fetch uses undici with headersTimeout=300s — too short for multi-agent LLM analysis.
// This agent raises both timeouts to 11 minutes for long-running /analyze/ calls only.
const longRunningAgent = new Agent({
  headersTimeout: 660_000,
  bodyTimeout:    660_000,
});

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompleteOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string; // pin to specific model, skips fallback chain
}

export interface CompleteResponse {
  content: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
}

export interface AnalyzeRequest {
  ticker: string;
  date: string; // YYYY-MM-DD
  analysts?: string[];
}

export interface AnalyzeResponse {
  ticker: string;
  date: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  market_report?: string;
  sentiment_report?: string;
  news_report?: string;
  fundamentals_report?: string;
  investment_plan?: string;
  final_trade_decision?: string;
}

const cb = new CircuitBreaker('trading-agents', { failureThreshold: 5, probeInterval: 30_000 });

async function post<T>(path: string, body: unknown, timeoutMs: number, dispatcher?: Dispatcher): Promise<T> {
  return cb.call(async () => {
    const res = await fetch(`${env.TRADING_AGENTS_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': env.INTERNAL_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      // @ts-ignore — dispatcher is undici-specific, not in standard fetch types
      dispatcher,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new LLMError(`trading-agents ${path} returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  });
}

// General LLM completion — Groq → Gemini → OpenAI → Anthropic fallback via LiteLLM
export function complete(messages: Message[], opts: CompleteOptions = {}): Promise<CompleteResponse> {
  return post<CompleteResponse>('/llm/complete', { messages, ...opts }, 30_000);
}

// Full TradingAgents multi-agent analysis — slow (30-600s), call from BullMQ worker only
// Uses longRunningAgent to override undici's default 5-minute headersTimeout
export function analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  return post<AnalyzeResponse>('/analyze/', req, 600_000, longRunningAgent);
}

// Technical indicators — RSI, MACD, BB, EMA, ATR, VWAP via YFinance + pandas-ta
export interface IndicatorsRequest {
  asset: string;
  period?: '1mo' | '3mo' | '6mo' | '1y' | '2y';
  indicators?: Array<'rsi' | 'macd' | 'bb' | 'ema' | 'atr' | 'vwap'>;
}

export interface IndicatorsResponse {
  asset: string;
  ticker: string;
  period: string;
  candles: number;
  rsi?: number;
  macd?: { macd: number; signal: number; hist: number };
  bb?: { upper: number; mid: number; lower: number; width: number; pct_b: number };
  ema?: { ema_9: number; ema_20: number; ema_50: number };
  atr?: number;
  vwap?: number;
}

export function getIndicators(req: IndicatorsRequest): Promise<IndicatorsResponse> {
  return post<IndicatorsResponse>('/indicators/', req, 15_000);
}

// ── Data endpoints ────────────────────────────────────────────────────────────

export type AssetType = 'crypto' | 'stock' | 'unknown';

export interface AssetTypeResponse {
  asset:      string;
  asset_type: AssetType;
}

export interface FundamentalsResponse {
  ticker:              string;
  name?:               string;
  sector?:             string;
  pe_ratio?:           number;
  forward_pe?:         number;
  peg_ratio?:          number;
  eps_ttm?:            number;
  eps_forward?:        number;
  profit_margin?:      number;
  roe?:                number;
  revenue_growth?:     number;
  earnings_growth?:    number;
  market_cap?:         number;
  debt_to_equity?:     number;
  short_percent_float?: number;
  beta?:               number;
  [key: string]: unknown;
}

export interface OnchainResponse {
  asset:                  string;
  name?:                  string;
  price_usd?:             number;
  price_change_24h_pct?:  number;
  price_change_7d_pct?:   number;
  market_cap_usd?:        number;
  market_cap_rank?:       number;
  total_volume_24h_usd?:  number;
  circulating_supply?:    number;
  sentiment_votes_up_pct?: number;
  sentiment_votes_down_pct?: number;
  [key: string]: unknown;
}

export interface InsidersResponse {
  ticker:          string;
  period_days:     number;
  buy_count:       number;
  sell_count:      number;
  net_shares:      number;
  total_value_usd?: number;
  transactions:    unknown[];
}

export function getAssetType(asset: string): Promise<AssetTypeResponse> {
  return post<AssetTypeResponse>('/data/asset-type', { asset }, 5_000);
}

export function getFundamentals(ticker: string): Promise<FundamentalsResponse> {
  return post<FundamentalsResponse>('/data/fundamentals', { ticker }, 15_000);
}

export function getOnchain(asset: string): Promise<OnchainResponse> {
  return post<OnchainResponse>('/data/onchain', { asset }, 15_000);
}

export function getInsiders(ticker: string, last_n_days = 90): Promise<InsidersResponse> {
  return post<InsidersResponse>('/data/insiders', { ticker, last_n_days }, 15_000);
}

export interface PriceHistoryResponse {
  asset:            string;
  ticker:           string;
  event_date:       string;
  price_at_event:   number | null;
  price_1d_after:   number | null;
  price_7d_after:   number | null;
  price_30d_after:  number | null;
  change_1d_pct:    number | null;
  change_7d_pct:    number | null;
  change_30d_pct:   number | null;
}

export function getPriceAt(asset: string, event_date: string): Promise<PriceHistoryResponse> {
  return post<PriceHistoryResponse>('/data/price-history', { asset, event_date }, 15_000);
}

// ── FRED economic indicators ───────────────────────────────────────────────────

export interface EconomicDataResponse {
  fed_rate:        number | null;
  cpi_yoy:         number | null;
  unemployment:    number | null;
  gdp_growth:      number | null;
  composite_score: number | null;
  degraded:        boolean;
  available_count: number;
}

export function getEconomicData(): Promise<EconomicDataResponse> {
  return post<EconomicDataResponse>('/data/economic', {}, 10_000);
}


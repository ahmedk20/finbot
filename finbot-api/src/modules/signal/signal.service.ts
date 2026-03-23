import { getAssetSentiment }             from '../sentiment/sentiment.service';
import { getIndicators, getEconomicData } from '../../shared/llm/llm.client';
import * as l2                            from '../../shared/cache/l2.cache';
import type { SignalResponse, SignalOutlook, SignalComponent } from './signal.types';

const SIGNAL_TTL_SEC = 60;

const DISCLAIMER =
  'This signal is generated from technical indicators and news sentiment. ' +
  'It is not financial advice. Always conduct your own research before trading.';

// ─── Outlook ──────────────────────────────────────────────────────────────────

function toOutlook(score: number): SignalOutlook {
  if (score >  0.25) return 'bullish';
  if (score < -0.25) return 'bearish';
  return 'neutral';
}

// ─── Confidence ───────────────────────────────────────────────────────────────

function toConfidence(filledComponents: number, total: number): 'low' | 'medium' | 'high' {
  const ratio = filledComponents / total;
  if (ratio >= 1)   return 'high';
  if (ratio >= 0.6) return 'medium';
  return 'low';
}

// ─── RSI normalisation ────────────────────────────────────────────────────────
/**
 * RSI (0–100) → score (-1 to +1)
 *
 * >70 overbought → bearish  (70→0,  100→-1)
 * <30 oversold   → bullish  (30→0,    0→+1)
 * 30–70 neutral  → linear ramp centred at 50
 *
 * Fix: the original formula `-1 + (rsi - 70) / -30` was wrong.
 * At rsi=70 it returned -1 (should be 0). Correct: `-(rsi - 70) / 30`.
 */
function rsiToScore(rsi: number): number {
  if (rsi >= 70) return -(rsi - 70) / 30;         // 70→0, 100→-1
  if (rsi <= 30) return  (30 - rsi) / 30;          // 30→0,   0→+1
  return -((rsi - 50) / 40);                        // 30–70: -0.5 to +0.5, neutral at 50
}

// ─── MACD normalisation ───────────────────────────────────────────────────────
/**
 * MACD histogram → score (-1 to +1)
 *
 * Positive histogram → bullish momentum (fast EMA above slow EMA)
 * Negative histogram → bearish momentum
 *
 * Fix: original used hardcoded price=1 which made MACD binary (any hist > 0.005 → clamped to 1).
 * We now require the actual asset price for normalisation. We use bb.mid (20-period SMA)
 * as a price proxy since it's always requested alongside MACD.
 * hist/price gives a percentage — comparable across BTC ($65k) and AAPL ($175).
 */
function macdToScore(hist: number, price: number): number {
  if (price <= 0) return 0;
  const pct = hist / price;             // e.g. AAPL hist=0.5, price=175 → 0.0029 (0.29%)
  return Math.max(-1, Math.min(1, pct * 200));  // scale: 0.5% move → score 1.0
}

// ─── Bollinger Band normalisation ─────────────────────────────────────────────
/**
 * BB %B: 0=lower band, 0.5=midline, 1=upper band
 * <0 → below lower band (very oversold)  → strong bullish
 * >1 → above upper band (very overbought) → strong bearish
 */
function bbToScore(pct_b: number): number {
  return Math.max(-1, Math.min(1, -(pct_b - 0.5) * 2));
}

// ─── Summary builder ──────────────────────────────────────────────────────────
/**
 * Synthesise all components into a plain English narrative.
 * Template-based (no LLM) — stays fast, stays free.
 * The trader reads this instead of acting on a raw BUY/SELL label.
 */
function buildSummary(components: SignalComponent[], score: number, confidence: string): string {
  const lines = components.map(c => c.reason);

  const direction =
    score >  0.5 ? 'strongly bullish' :
    score >  0.25 ? 'moderately bullish' :
    score < -0.5 ? 'strongly bearish' :
    score < -0.25 ? 'moderately bearish' :
    'neutral';

  lines.push(
    `Composite score: ${score.toFixed(3)} (${direction}). ` +
    `Confidence: ${confidence} — based on ${components.length} of 5 available indicators.`,
  );

  return lines.join(' ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function computeSignal(asset: string): Promise<SignalResponse> {
  const ticker = asset.toUpperCase();
  const key    = `signal:${ticker}`;

  const cached = await l2.get<SignalResponse>(key);
  if (cached) return cached;

  const components: SignalComponent[] = [];
  let   weightedSum  = 0;
  let   filledWeight = 0;   // tracks sum of weights for present components
  let   filled       = 0;   // tracks count for confidence
  const TOTAL_COMPONENTS = 5;

  // ── 1. Sentiment score (35%) ───────────────────────────────────────────────
  try {
    const sentiment = await getAssetSentiment(ticker, { window: '24h' });
    if (sentiment && sentiment.score !== null) {
      const w     = 0.35;
      const score = sentiment.score;
      weightedSum  += score * w;
      filledWeight += w;
      filled++;
      components.push({
        name:   'sentiment',
        score,
        weight: w,
        reason: `Sentiment across ${sentiment.articleCount} articles (last 24h): ` +
                `${sentiment.label} (score ${score.toFixed(2)}).`,
      });
    }
  } catch {
    components.push({
      name:   'sentiment',
      score:  0,
      weight: 0.35,
      reason: 'News sentiment unavailable — excluded from score.',
    });
  }

  // ── 2–4. Technical indicators (55%) ───────────────────────────────────────
  try {
    const ind = await getIndicators({
      asset:      ticker,
      period:     '3mo',
      indicators: ['rsi', 'macd', 'bb'],
    });

    // Use BB midline (20-period SMA) as price proxy for MACD normalisation.
    // It's always present when BB is requested and closely tracks current price.
    const price = ind.bb?.mid ?? 0;

    // RSI (25%)
    if (ind.rsi != null) {
      const w     = 0.25;
      const score = rsiToScore(ind.rsi);
      weightedSum  += score * w;
      filledWeight += w;
      filled++;
      components.push({
        name:   'rsi',
        score,
        weight: w,
        reason: `RSI at ${ind.rsi.toFixed(1)}: ` +
                `${ind.rsi > 70 ? 'overbought — selling pressure likely' :
                   ind.rsi < 30 ? 'oversold — potential reversal upward' :
                   'neutral range — no strong momentum signal'}.`,
      });
    }

    // MACD histogram (18%)
    if (ind.macd?.hist != null) {
      const w     = 0.18;
      const score = macdToScore(ind.macd.hist, price);
      weightedSum  += score * w;
      filledWeight += w;
      filled++;
      components.push({
        name:   'macd',
        score,
        weight: w,
        reason: `MACD histogram at ${ind.macd.hist.toFixed(4)}: ` +
                `${ind.macd.hist > 0 ? 'positive — bullish momentum, fast EMA above slow EMA' :
                                       'negative — bearish momentum, fast EMA below slow EMA'}.`,
      });
    }

    // Bollinger Bands %B (12%)
    if (ind.bb?.pct_b != null) {
      const w     = 0.12;
      const score = bbToScore(ind.bb.pct_b);
      weightedSum  += score * w;
      filledWeight += w;
      filled++;
      components.push({
        name:   'bb_pct_b',
        score,
        weight: w,
        reason: `Price at ${(ind.bb.pct_b * 100).toFixed(0)}% within Bollinger Bands: ` +
                `${ind.bb.pct_b > 1   ? 'above upper band — extended, watch for reversal' :
                   ind.bb.pct_b < 0   ? 'below lower band — may be oversold' :
                   ind.bb.pct_b > 0.8 ? 'near upper band — approaching resistance' :
                   ind.bb.pct_b < 0.2 ? 'near lower band — approaching support' :
                   'within bands — no extreme reading'}.`,
      });
    }
  } catch {
    components.push({
      name:   'technicals',
      score:  0,
      weight: 0.55,
      reason: 'Technical indicators unavailable (trading-agents offline) — excluded from score.',
    });
  }

  // ── 5. Macro economic context (10%) ────────────────────────────────────────
  try {
    const eco = await getEconomicData();
    if (!eco.degraded && eco.composite_score !== null) {
      const w     = 0.10;
      const score = eco.composite_score;
      weightedSum  += score * w;
      filledWeight += w;
      filled++;

      const parts: string[] = [];
      if (eco.fed_rate   != null) parts.push(`Fed rate ${eco.fed_rate}%`);
      if (eco.cpi_yoy    != null) parts.push(`CPI YoY ${eco.cpi_yoy.toFixed(1)}%`);
      if (eco.unemployment != null) parts.push(`unemployment ${eco.unemployment}%`);
      if (eco.gdp_growth != null) parts.push(`GDP growth ${eco.gdp_growth}%`);

      components.push({
        name:   'economic',
        score,
        weight: w,
        reason: `Macro context (${parts.join(', ')}): ` +
                `composite macro score ${score.toFixed(2)} ` +
                `(${score > 0.2 ? 'risk-on environment' : score < -0.2 ? 'risk-off environment' : 'neutral macro backdrop'}).`,
      });
    }
  } catch {
    // Economic data is optional — trading-agents may not have FRED key configured
  }

  /**
   * Bug fix: weight redistribution.
   * If some components are missing, normalise by filledWeight so the score
   * stays in [-1, +1] relative to available data, not artificially compressed.
   *
   * Example: if sentiment (0.40) is missing, filledWeight = 0.60.
   * Without fix: max score = 0.60 (feels like a weak bullish signal).
   * With fix:    max score = 1.00 (correctly represents strong technicals).
   */
  const finalScore = filledWeight > 0
    ? Math.max(-1, Math.min(1, weightedSum / filledWeight))
    : 0;

  const roundedScore = Math.round(finalScore * 1000) / 1000;
  const confidence   = toConfidence(filled, TOTAL_COMPONENTS);

  const result: SignalResponse = {
    asset:      ticker,
    outlook:    toOutlook(roundedScore),
    score:      roundedScore,
    confidence,
    summary:    buildSummary(components, roundedScore, confidence),
    components,
    computedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };

  await l2.set(key, result, SIGNAL_TTL_SEC);
  return result;
}

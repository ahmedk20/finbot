/**
 * Unit tests — signal.service.ts
 *
 * Tests outlook thresholds, confidence levels, RSI/MACD/BB normalization,
 * weight redistribution when components are missing, and summary generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as l2 from '../../shared/cache/l2.cache';
import * as sentimentService from '../sentiment/sentiment.service';
import * as llmClient from '../../shared/llm/llm.client';
import { computeSignal } from './signal.service';

vi.mock('../../shared/cache/l2.cache');
vi.mock('../sentiment/sentiment.service');
vi.mock('../../shared/llm/llm.client');

const mockSentiment = (score: number) => ({
  asset: 'AAPL', score,
  label: score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral' as const,
  articleCount: 5, window: '24h' as const,
  breakdown: { bullish: 3, neutral: 1, bearish: 1 },
  computedAt: new Date().toISOString(),
});

// bb.mid is required — used as price proxy for MACD normalisation
const mockIndicators = (rsi: number, macdHist: number, pct_b: number, mid = 140) => ({
  asset: 'AAPL', ticker: 'AAPL', period: '3mo', candles: 60,
  rsi,
  macd: { hist: macdHist, macd: 0, signal: 0 },
  bb:   { pct_b, upper: 160, lower: 120, mid, width: 0.28 },
});

// Default: degraded=true so economic component is silently skipped in most tests
const mockEconomicDegraded = () => ({
  fed_rate: null, cpi_yoy: null, unemployment: null, gdp_growth: null,
  composite_score: null, degraded: true, available_count: 0,
});

const mockEconomicData = (compositeScore: number) => ({
  fed_rate: 4.5, cpi_yoy: 3.2, unemployment: 4.1, gdp_growth: 2.5,
  composite_score: compositeScore, degraded: false, available_count: 4,
});

// ─── Outlook thresholds ───────────────────────────────────────────────────────

describe('computeSignal — outlook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Economic data degraded by default — keeps existing tests unaffected
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());
  });

  it('returns cached result without recomputing', async () => {
    const cached = {
      asset: 'AAPL', outlook: 'bullish' as const, score: 0.5,
      confidence: 'high' as const, summary: 'cached', components: [],
      computedAt: new Date().toISOString(), disclaimer: 'not financial advice',
    };
    vi.mocked(l2.get).mockResolvedValue(cached);

    const result = await computeSignal('AAPL');

    expect(result).toEqual(cached);
    expect(sentimentService.getAssetSentiment).not.toHaveBeenCalled();
  });

  it('returns bullish when combined score > 0.25', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.8));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(
      mockIndicators(25, 0.5, 0.1, 140), // oversold RSI, bullish MACD, near lower BB
    );

    const result = await computeSignal('AAPL');

    expect(result.outlook).toBe('bullish');
    expect(result.score).toBeGreaterThan(0.25);
  });

  it('returns bearish when combined score < -0.25', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(-0.8));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(
      mockIndicators(80, -0.5, 0.95, 140), // overbought RSI, bearish MACD, near upper BB
    );

    const result = await computeSignal('AAPL');

    expect(result.outlook).toBe('bearish');
    expect(result.score).toBeLessThan(-0.25);
  });

  it('returns neutral when score is between -0.25 and 0.25', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.0));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(
      mockIndicators(50, 0.01, 0.5, 140), // all neutral
    );

    const result = await computeSignal('AAPL');

    expect(result.outlook).toBe('neutral');
    expect(Math.abs(result.score)).toBeLessThanOrEqual(0.25);
  });

  it('never returns decision — returns outlook instead', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(50, 0.1, 0.5));

    const result = await computeSignal('AAPL');

    expect((result as any).decision).toBeUndefined();
    expect(result.outlook).toBeDefined();
  });
});

// ─── Reasoning ────────────────────────────────────────────────────────────────

describe('computeSignal — reasoning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());
  });

  it('includes a non-empty summary', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(55, 0.2, 0.45));

    const result = await computeSignal('AAPL');

    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(20);
  });

  it('always includes a disclaimer', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(55, 0.2, 0.45));

    const result = await computeSignal('AAPL');

    expect(result.disclaimer).toBeDefined();
    expect(result.disclaimer.length).toBeGreaterThan(10);
  });

  it('each component has a human-readable reason', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(55, 0.2, 0.45));

    const result = await computeSignal('AAPL');

    result.components.forEach(c => {
      expect(typeof c.reason).toBe('string');
      expect(c.reason.length).toBeGreaterThan(10);
    });
  });
});

// ─── Confidence ───────────────────────────────────────────────────────────────

describe('computeSignal — confidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());
  });

  it('returns high confidence when all 5 components are available', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(45, 0.5, 0.4));
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicData(0.2));

    const result = await computeSignal('AAPL');

    expect(result.confidence).toBe('high');
    expect(result.components.length).toBeGreaterThanOrEqual(5);
  });

  it('returns medium confidence with 4 of 5 components (economic degraded)', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(45, 0.5, 0.4));
    // economic degraded — 4/5 = 0.8 → medium
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());

    const result = await computeSignal('AAPL');

    expect(result.confidence).toBe('medium');
  });

  it('returns low confidence when indicators unavailable', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockRejectedValue(new Error('trading-agents down'));

    const result = await computeSignal('AAPL');

    expect(result.confidence).toBe('low');
  });

  it('normalises ticker to uppercase', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.3));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(50, 0.5, 0.5));

    const result = await computeSignal('aapl');

    expect(result.asset).toBe('AAPL');
  });
});

// ─── RSI normalisation ────────────────────────────────────────────────────────

describe('computeSignal — RSI normalisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());
  });

  it('RSI > 70 generates negative (bearish) component score', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(85, 0, 0.5));

    const result = await computeSignal('AAPL');
    const rsi = result.components.find(c => c.name === 'rsi');

    expect(rsi?.score).toBeLessThan(0);
  });

  it('RSI < 30 generates positive (bullish) component score', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(15, 0, 0.5));

    const result = await computeSignal('AAPL');
    const rsi = result.components.find(c => c.name === 'rsi');

    expect(rsi?.score).toBeGreaterThan(0);
  });

  it('RSI at 70 scores exactly 0 (boundary — just entered overbought)', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(70, 0, 0.5));

    const result = await computeSignal('AAPL');
    const rsi = result.components.find(c => c.name === 'rsi');

    expect(rsi?.score).toBeCloseTo(0);
  });

  it('RSI at 100 scores -1 (maximum bearish)', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(100, 0, 0.5));

    const result = await computeSignal('AAPL');
    const rsi = result.components.find(c => c.name === 'rsi');

    expect(rsi?.score).toBe(-1);
  });
});

// ─── Weight redistribution ────────────────────────────────────────────────────

describe('computeSignal — weight redistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());
  });

  it('score stays in [-1,+1] when sentiment is missing', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    // All technicals strongly bullish
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(15, 2.0, 0.0, 140));

    const result = await computeSignal('AAPL');

    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('full bullish technicals without sentiment still reaches bullish outlook', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(15, 2.0, 0.0, 140));

    const result = await computeSignal('AAPL');

    // Without redistribution: score would be capped at 0.60 (below strong bullish)
    // With redistribution: score is normalised to actual signal strength
    expect(result.outlook).toBe('bullish');
    expect(result.score).toBeGreaterThan(0.25);
  });

  it('returns score 0 when no components are available', async () => {
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockRejectedValue(new Error('no data'));

    const result = await computeSignal('AAPL');

    expect(result.score).toBe(0);
    expect(result.outlook).toBe('neutral');
    expect(result.confidence).toBe('low');
  });
});

// ─── Economic component ────────────────────────────────────────────────────────

describe('computeSignal — economic component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(l2.get).mockResolvedValue(null);
    vi.mocked(l2.set).mockResolvedValue(undefined);
  });

  it('includes economic component when FRED data is available', async () => {
    vi.mocked(sentimentService.getAssetSentiment).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getIndicators).mockRejectedValue(new Error('no data'));
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicData(0.5));

    const result = await computeSignal('AAPL');
    const eco = result.components.find(c => c.name === 'economic');

    expect(eco).toBeDefined();
    expect(eco?.score).toBe(0.5);
    expect(eco?.weight).toBe(0.10);
    expect(typeof eco?.reason).toBe('string');
  });

  it('silently skips economic component when degraded', async () => {
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(50, 0.1, 0.5));
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicDegraded());

    const result = await computeSignal('AAPL');
    const eco = result.components.find(c => c.name === 'economic');

    expect(eco).toBeUndefined();
  });

  it('silently skips economic component when getEconomicData throws', async () => {
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.5));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(50, 0.1, 0.5));
    vi.mocked(llmClient.getEconomicData).mockRejectedValue(new Error('FRED down'));

    const result = await computeSignal('AAPL');

    // Other components still present; economic silently absent
    expect(result.score).not.toBe(0);
    expect(result.components.find(c => c.name === 'economic')).toBeUndefined();
  });

  it('bearish macro score pulls composite score down', async () => {
    vi.mocked(sentimentService.getAssetSentiment).mockResolvedValue(mockSentiment(0.0));
    vi.mocked(llmClient.getIndicators).mockResolvedValue(mockIndicators(50, 0, 0.5)); // neutral technicals
    vi.mocked(llmClient.getEconomicData).mockResolvedValue(mockEconomicData(-0.9));

    const result = await computeSignal('AAPL');

    expect(result.score).toBeLessThan(0);
  });
});

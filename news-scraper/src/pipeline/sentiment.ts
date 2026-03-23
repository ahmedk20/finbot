/**
 * FinBERT sentiment scorer — labels each article bullish / bearish / neutral.
 *
 * Model: ProsusAI/finbert (BERT fine-tuned on financial news phrases)
 * Input:  article title + summary (same text we embed)
 * Output: ScoredArticle[] — EmbeddedArticle + sentiment label + score + severity
 *
 * FinBERT returns three class scores (POSITIVE / NEGATIVE / NEUTRAL) per text.
 * We pick the highest and map: POSITIVE → bullish | NEGATIVE → bearish | NEUTRAL → neutral
 *
 * Severity:  ≥ 0.85 → high  |  ≥ 0.65 → medium  |  < 0.65 → low
 *            Neutral articles are always low regardless of score.
 *
 * Rate limiting: HF free tier = 200 req / 5 min = 40 req/min.
 * We throttle to 1 request per 1.6 seconds (37.5/min — safe margin).
 * This means:
 *   - Initial run  (~600 articles): ~16 minutes  [one-time cost]
 *   - Incremental  (~80 new/2 hrs): ~2 minutes   [normal cadence]
 */

import axios from 'axios';
import pLimit from 'p-limit';
import pino from 'pino';
import { env } from '../config/env';
import { EmbeddedArticle } from './embedder';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SentimentLabel = 'bullish' | 'bearish' | 'neutral';
export type Severity       = 'high' | 'medium' | 'low';

export interface ScoredArticle extends EmbeddedArticle {
  sentiment:      SentimentLabel;
  sentimentScore: number;          // 0.0 – 1.0  (confidence in the winning label)
  severity:       Severity;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FINBERT_URL = 'https://router.huggingface.co/hf-inference/models/ProsusAI/finbert';
const DELAY_MS    = 1600;  // 37.5 req/min — stays under 40 req/min free tier limit

const FALLBACK: Pick<ScoredArticle, 'sentiment' | 'sentimentScore' | 'severity'> = {
  sentiment:      'neutral',
  sentimentScore: 0.5,
  severity:       'low',
};

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });
const limit  = pLimit(1); // strictly sequential — rate limit requires it

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function mapLabel(label: string): SentimentLabel {
  const l = label.toLowerCase();
  if (l === 'positive') return 'bullish';
  if (l === 'negative') return 'bearish';
  return 'neutral';
}

function deriveSeverity(score: number, label: SentimentLabel): Severity {
  if (label === 'neutral') return 'low';
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

// ─── Single-text scorer ───────────────────────────────────────────────────────

/**
 * Score one text via FinBERT (single-text call — API doesn't support batching).
 *
 * HF response shape: [[{label, score}, {label, score}, {label, score}]]
 * Outer array = 1 entry for our 1 input. Inner array = all 3 class scores, sorted desc.
 * [0] is the winning label.
 */
async function scoreOne(text: string): Promise<{ label: string; score: number } | null> {
  try {
    const response = await axios.post<Array<Array<{ label: string; score: number }>>>(
      FINBERT_URL,
      { inputs: text },
      {
        headers: {
          Authorization:  `Bearer ${env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    );

    // [[{label, score}, ...]] — unwrap both layers
    const classScores = response.data?.[0];
    if (!Array.isArray(classScores) || classScores.length === 0) return null;
    return classScores[0]; // highest-scored label
  } catch (err: any) {
    logger.warn(
      { status: err?.response?.status, message: err?.message },
      'FinBERT call failed — using fallback',
    );
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scoreArticles(embedded: EmbeddedArticle[]): Promise<ScoredArticle[]> {
  logger.info(
    { total: embedded.length, estimatedMinutes: Math.ceil((embedded.length * DELAY_MS) / 60_000) },
    'Sentiment scoring started — throttled to 37.5 req/min (HF free tier)',
  );

  let done = 0;

  const scored = await Promise.all(
    embedded.map(e =>
      limit(async (): Promise<ScoredArticle> => {
        const text = `${e.article.title}. ${e.article.summary}`;
        const top  = await scoreOne(text);

        await sleep(DELAY_MS); // enforce rate limit

        done++;
        if (done % 50 === 0) {
          logger.info({ done, total: embedded.length }, 'Sentiment scoring progress');
        }

        if (!top) return { ...e, ...FALLBACK };

        const sentiment      = mapLabel(top.label);
        const sentimentScore = top.score;
        const severity       = deriveSeverity(top.score, sentiment);
        return { ...e, sentiment, sentimentScore, severity };
      }),
    ),
  );

  const bullish = scored.filter(s => s.sentiment === 'bullish').length;
  const bearish = scored.filter(s => s.sentiment === 'bearish').length;
  const neutral = scored.filter(s => s.sentiment === 'neutral').length;
  logger.info({ total: scored.length, bullish, bearish, neutral }, 'Sentiment scoring complete');

  return scored;
}

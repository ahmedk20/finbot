/**
 * Signal types.
 *
 * Deliberately uses 'outlook' instead of 'decision'.
 * The signal engine computes a score from technical indicators + sentiment.
 * It does NOT make a trading decision — that's the trader's job.
 * 'outlook' is directional context, not financial advice.
 */

export type SignalOutlook = 'bearish' | 'neutral' | 'bullish';

export interface SignalComponent {
  name:   string;
  score:  number;   // -1 to +1 contribution from this indicator
  weight: number;   // original weight (0-1) — for display only
  reason: string;   // plain English: what this indicator is saying and why
}

export interface SignalResponse {
  asset:      string;
  outlook:    SignalOutlook;          // directional context — NOT a trade recommendation
  score:      number;                 // -1 (strong bearish) to +1 (strong bullish)
  confidence: 'low' | 'medium' | 'high';
  summary:    string;                 // plain English synthesis of all components
  components: SignalComponent[];      // full breakdown so the trader can judge each indicator
  computedAt: string;
  disclaimer: string;                 // always present — this is not financial advice
}

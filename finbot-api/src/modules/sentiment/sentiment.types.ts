export type SentimentLabel = 'bullish' | 'bearish' | 'neutral';

// What the LLM returns after analyzing one article
export interface LLMSentimentResult {
  score: number;        // -1.0 to +1.0
  label: SentimentLabel;
  reasoning: string;   // one-sentence explanation — useful for debugging bad scores
  model_used: string;  // which LLM produced this (audit trail)
}

// What we store in Postgres (one row per article)
export interface SentimentScoreRecord {
  id:        string;
  articleId: string;
  asset:     string;
  score:     number;
  label:     string;
  model:     string;
  createdAt: Date;
}

// What GET /sentiment/:asset returns
export interface AssetSentiment {
  asset:        string;
  score:        number;          // weighted average across articles
  label:        SentimentLabel;
  articleCount: number;
  window:       string;          // "24h" or "7d"
  breakdown: {
    bullish: number;
    neutral: number;
    bearish: number;
  };
  computedAt: string;            // ISO 8601
}

// BullMQ job payload — what the queue carries
export interface SentimentJobData {
  articleId: string;
  asset:     string;
}

export type Sentiment = 'bullish' | 'bearish' | 'neutral';
export type Severity  = 'critical' | 'high' | 'medium' | 'low';
export type SourceTier = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'research' | 'geopolitical';

export interface NewsItem {
  id:             string;
  title:          string;
  url:            string;
  source:         string;
  sourceTier:     SourceTier;
  asset:          string;
  category:       string;
  summary:        string;
  sentiment:      Sentiment;
  sentimentScore: number;
  severity:       Severity;
  credibility:    number;
  reputation:     number;
  publishedAt:    string;
  score?:         number; // Pinecone similarity score
}

export interface NewsQuery {
  asset?:     string;
  limit:      number;
  sentiment?: Sentiment;
  severity?:  Severity;
  tier?:      SourceTier;
  hours:      number;
  query?:     string;
}

export interface NewsServiceResult {
  articles:   NewsItem[];
  summary?:   string;
  total:      number;
  cached:     boolean;
  latency_ms: number;
}

// ── Historical context types ───────────────────────────────────────────────────

export interface PriceOutcome {
  priceAtEvent:  number | null;
  price1dAfter:  number | null;
  price7dAfter:  number | null;
  price30dAfter: number | null;
  change1dPct:   number | null;
  change7dPct:   number | null;
  change30dPct:  number | null;
}

export interface SimilarHistoricalEvent {
  id:             string;
  title:          string;
  publishedAt:    string;
  asset:          string;
  sentiment:      Sentiment;
  sentimentScore: number;
  similarity:     number;       // Pinecone cosine similarity 0–1
  priceOutcome:   PriceOutcome;
}

export interface PatternSummary {
  eventCount:          number;
  bullishOutcomes7d:   number;  // events where price was up 7d later
  bearishOutcomes7d:   number;  // events where price was down 7d later
  avgChange7dPct:      number | null;
  avgChange30dPct:     number | null;
}

export interface ArticleContext {
  article:           NewsItem;
  historicalContext: {
    similarEvents:  SimilarHistoricalEvent[];
    patternSummary: PatternSummary;
    summary:        string;
  };
}

import { SourceTier } from '../sources/crypto.sources';

export interface Article {
  id:           string;    // hash of url — used for deduplication
  title:        string;
  content:      string;    // full article text
  summary:      string;    // first 300 chars
  url:          string;
  imageUrl:     string;
  publishedAt:  string;    // ISO 8601
  source:       string;    // e.g. "CoinDesk"
  category:     string;    // e.g. "bitcoin" | "ethereum" | "regulation"
  asset:        string;    // e.g. "BTC" | "ETH" | "general"
  sourceTier:   SourceTier;
  credibility:  number;    // 0–1  (how trustworthy the source is)
  reputation:   number;    // 0–100 (how market-moving the source is)
}

export interface RawArticle {
  title:       string;
  url:         string;
  imageUrl:    string;
  publishedAt: string;
  content:     string;
  source:      string;
}

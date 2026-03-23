/**
 * Normalizer — converts a raw RSS item + source metadata into a clean Article.
 *
 * Responsibilities:
 *  - Map RSS fields to Article fields
 *  - Detect category from title + description keywords
 *  - Derive asset symbol from category (BTC/ETH/general)
 *  - Generate stable ID from URL hash
 *  - Truncate content to summary (first 300 chars)
 */

import { Article } from '../types/article';
import { CryptoSource } from '../sources/crypto.sources';
import { hashUrl } from '../scraper/dedupe';
import { matchArticleToCategories } from './categories';

// ─── Category → Asset mapping ─────────────────────────────────────────────────
// Only map categories that clearly represent a single tradeable asset.
// Everything else falls back to "general".

const CATEGORY_TO_ASSET: Record<string, string> = {
  bitcoin:  'BTC',
  ethereum: 'ETH',
  solana:   'SOL',
  altcoins: 'general',
  defi:     'general',
  nft:      'general',
  trading:  'general',
  regulation:   'general',
  technology:   'general',
  geopolitical: 'general',
};

function deriveAsset(categories: string[]): string {
  for (const cat of categories) {
    const asset = CATEGORY_TO_ASSET[cat];
    if (asset && asset !== 'general') return asset;
  }
  return 'general';
}

// ─── RSS item shape (what rss-parser gives us) ────────────────────────────────

export interface RssItem {
  title?:          string;
  link?:           string;
  pubDate?:        string;
  isoDate?:        string;
  content?:        string;
  contentSnippet?: string;
  enclosure?:      { url?: string };
  summary?:        string;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * Normalize one RSS item from a given source into an Article.
 * Returns null if the item is missing required fields (title or link).
 */
export function normalizeItem(item: RssItem, source: CryptoSource): Article | null {
  const title = item.title?.trim();
  const url   = item.link?.trim();

  if (!title || !url) return null;

  const content   = item.content        || item.summary || '';
  const snippet   = item.contentSnippet || item.summary || '';
  const summary   = snippet.slice(0, 300);
  const imageUrl  = item.enclosure?.url || '';
  const publishedAt = item.isoDate || item.pubDate
    ? new Date(item.isoDate || item.pubDate!).toISOString()
    : new Date().toISOString();

  // Detect categories from title + snippet
  const categories = matchArticleToCategories(title, snippet);
  const category   = categories[0] ?? source.category;
  const asset      = deriveAsset(categories);

  return {
    id:          hashUrl(url),
    title,
    content,
    summary,
    url,
    imageUrl,
    publishedAt,
    source:      source.name,
    category,
    asset,
    sourceTier:  source.sourceTier,
    credibility: source.credibility,
    reputation:  source.reputation,
  };
}

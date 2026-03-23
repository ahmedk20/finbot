/**
 * Curated crypto RSS sources — 60 high-signal feeds.
 * Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 *
 * Source tier system (inspired by free-crypto-news source-tiers.ts):
 *   tier1       Mainstream / institutional media      credibility 0.88–0.98  reputation 88–100
 *   tier2       Premium crypto-native outlets         credibility 0.86–0.95  reputation 65–90
 *   tier3       Established crypto news               credibility 0.68–0.82  reputation 60–80
 *   tier4       Aggregators & volume sources          credibility 0.60–0.70  reputation 50–60
 *   research    Institutional research firms          credibility 0.88–0.94  reputation 68–72
 *   geopolitical Regulators & central banks          credibility 0.95–0.99  reputation 95–100
 *
 * credibility (0–1) — how trustworthy/accurate the source is
 * reputation  (0–100) — how market-moving the source is (influence)
 * These are different: a source can be credible but low-influence (academic)
 * or high-influence but lower credibility (aggregators).
 */

export type SourceTier = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'research' | 'geopolitical';

export interface CryptoSource {
  key:          string;
  name:         string;
  url:          string;
  category:     string;
  sourceTier:   SourceTier;
  credibility:  number;   // 0–1
  reputation:   number;   // 0–100
}

export const CRYPTO_SOURCES: CryptoSource[] = [

  // ─── Tier 1: Mainstream / Institutional Media ─────────────────────────────
  {
    key: 'coindesk', name: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'general', sourceTier: 'tier1', credibility: 0.95, reputation: 90,
  },
  {
    key: 'theblock', name: 'The Block',
    url: 'https://www.theblock.co/rss.xml',
    category: 'general', sourceTier: 'tier1', credibility: 0.93, reputation: 88,
  },
  {
    key: 'decrypt', name: 'Decrypt',
    url: 'https://decrypt.co/feed',
    category: 'general', sourceTier: 'tier1', credibility: 0.88, reputation: 85,
  },
  {
    key: 'blockworks', name: 'Blockworks',
    url: 'https://blockworks.co/feed',
    category: 'general', sourceTier: 'tier1', credibility: 0.90, reputation: 85,
  },
  {
    key: 'cnbc_crypto', name: 'CNBC Crypto',
    url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',
    category: 'mainstream', sourceTier: 'tier1', credibility: 0.93, reputation: 95,
  },
  {
    key: 'techcrunch_crypto', name: 'TechCrunch Crypto',
    url: 'https://techcrunch.com/category/cryptocurrency/feed/',
    category: 'mainstream', sourceTier: 'tier1', credibility: 0.90, reputation: 92,
  },
  // bloomberg_crypto — feed URL dead (404), paywalled
  // reuters_crypto   — DNS dead (feeds.reuters.com removed)
  // forbes_crypto    — feed URL dead (404)
  {
    key: 'ft_crypto', name: 'Financial Times Crypto',
    url: 'https://www.ft.com/cryptofinance?format=rss',
    category: 'mainstream', sourceTier: 'tier1', credibility: 0.97, reputation: 98,
  },

  // ─── Tier 2: Premium Crypto-Native Outlets ────────────────────────────────
  {
    key: 'cointelegraph', name: 'CoinTelegraph',
    url: 'https://cointelegraph.com/rss',
    category: 'general', sourceTier: 'tier2', credibility: 0.78, reputation: 80,
  },
  {
    key: 'defiant', name: 'The Defiant',
    url: 'https://thedefiant.io/feed',
    category: 'defi', sourceTier: 'tier2', credibility: 0.87, reputation: 75,
  },
  {
    key: 'bitcoinmagazine', name: 'Bitcoin Magazine',
    url: 'https://bitcoinmagazine.com/.rss/full/',
    category: 'bitcoin', sourceTier: 'tier2', credibility: 0.82, reputation: 78,
  },
  {
    key: 'unchained_crypto', name: 'Unchained Crypto',
    url: 'https://unchainedcrypto.com/feed/',
    category: 'journalism', sourceTier: 'tier2', credibility: 0.88, reputation: 68,
  },
  // bankless      — SSL cert mismatch (moved host)
  // dlnews        — invalid XML entity characters in feed
  // coinbase_blog — 403 Forbidden
  {
    key: 'protos', name: 'Protos',
    url: 'https://protos.com/feed/',
    category: 'journalism', sourceTier: 'tier2', credibility: 0.85, reputation: 68,
  },
  {
    key: 'fidelity_digital', name: 'Fidelity Digital Assets',
    url: 'https://www.fidelitydigitalassets.com/rss.xml',
    category: 'institutional', sourceTier: 'tier2', credibility: 0.92, reputation: 88,
  },

  // ─── Research: Institutional Research & On-Chain Analytics ───────────────
  {
    key: 'messari', name: 'Messari',
    url: 'https://messari.io/rss',
    category: 'research', sourceTier: 'research', credibility: 0.92, reputation: 72,
  },
  {
    key: 'glassnode_insights', name: 'Glassnode Insights',
    url: 'https://insights.glassnode.com/rss/',
    category: 'research', sourceTier: 'research', credibility: 0.92, reputation: 70,
  },
  // cryptoquant_blog — 403 Forbidden
  {
    key: 'cryptobriefing', name: 'Crypto Briefing',
    url: 'https://cryptobriefing.com/feed/',
    category: 'research', sourceTier: 'research', credibility: 0.82, reputation: 65,
  },
  {
    key: 'thedefireport', name: 'The DeFi Report',
    url: 'https://thedefireport.substack.com/feed',
    category: 'research', sourceTier: 'research', credibility: 0.85, reputation: 65,
  },
  {
    key: 'nansen_blog', name: 'Nansen',
    url: 'https://nansen.substack.com/feed',
    category: 'research', sourceTier: 'research', credibility: 0.90, reputation: 70,
  },

  // ─── Geopolitical: Regulators & Central Banks ─────────────────────────────
  {
    key: 'sec_press', name: 'SEC Press Releases',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    category: 'geopolitical', sourceTier: 'geopolitical', credibility: 0.99, reputation: 100,
  },
  {
    key: 'federal_reserve', name: 'Federal Reserve',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    category: 'geopolitical', sourceTier: 'geopolitical', credibility: 0.99, reputation: 100,
  },
  // cftc_press — 403 Forbidden
  {
    key: 'coincenter', name: 'Coin Center',
    url: 'https://www.coincenter.org/feed/',
    category: 'geopolitical', sourceTier: 'geopolitical', credibility: 0.93, reputation: 82,
  },
  // bis_innovation — 404 (feed URL changed)

  // ─── Tier 3: Established Crypto News ──────────────────────────────────────
  {
    key: 'bitcoinist', name: 'Bitcoinist',
    url: 'https://bitcoinist.com/feed/',
    category: 'bitcoin', sourceTier: 'tier3', credibility: 0.72, reputation: 68,
  },
  // cryptoslate — 403 Forbidden
  // beincrypto  — 403 Forbidden
  {
    key: 'newsbtc', name: 'NewsBTC',
    url: 'https://www.newsbtc.com/feed/',
    category: 'general', sourceTier: 'tier3', credibility: 0.70, reputation: 65,
  },
  // thestreet_crypto — 404 (feed removed)
  // benzinga_crypto  — 404 (feed removed)
  {
    key: 'dailyhodl', name: 'The Daily Hodl',
    url: 'https://dailyhodl.com/feed/',
    category: 'general', sourceTier: 'tier3', credibility: 0.72, reputation: 65,
  },
  {
    key: 'watcherguru', name: 'Watcher Guru',
    url: 'https://watcher.guru/news/feed',
    category: 'general', sourceTier: 'tier3', credibility: 0.68, reputation: 60,
  },
  {
    key: 'cryptopolitan', name: 'Cryptopolitan',
    url: 'https://www.cryptopolitan.com/feed/',
    category: 'general', sourceTier: 'tier3', credibility: 0.68, reputation: 60,
  },
  {
    key: 'forkast', name: 'Forkast News',
    url: 'https://forkast.news/feed/',
    category: 'asia', sourceTier: 'tier3', credibility: 0.78, reputation: 68,
  },
  {
    key: 'solana_news', name: 'Solana News',
    url: 'https://solana.com/news/rss.xml',
    category: 'solana', sourceTier: 'tier3', credibility: 0.80, reputation: 70,
  },
  {
    key: 'slowmist', name: 'SlowMist Blog',
    url: 'https://slowmist.medium.com/feed',
    category: 'security', sourceTier: 'tier3', credibility: 0.85, reputation: 72,
  },

  // ─── Tier 4: Aggregators & Volume Sources ─────────────────────────────────
  {
    key: 'ambcrypto', name: 'AMBCrypto',
    url: 'https://ambcrypto.com/feed/',
    category: 'trading', sourceTier: 'tier4', credibility: 0.65, reputation: 55,
  },
  {
    key: 'u_today', name: 'U.Today',
    url: 'https://u.today/rss',
    category: 'trading', sourceTier: 'tier4', credibility: 0.70, reputation: 62,
  },
  {
    key: 'coingape', name: 'CoinGape',
    url: 'https://coingape.com/feed/',
    category: 'general', sourceTier: 'tier4', credibility: 0.65, reputation: 55,
  },
  {
    key: 'cryptopotato', name: 'CryptoPotato',
    url: 'https://cryptopotato.com/feed/',
    category: 'general', sourceTier: 'tier4', credibility: 0.65, reputation: 55,
  },
  {
    key: 'cryptonews', name: 'Crypto.news',
    url: 'https://crypto.news/feed/',
    category: 'general', sourceTier: 'tier4', credibility: 0.68, reputation: 58,
  },
  {
    key: 'coinpedia', name: 'CoinPedia',
    url: 'https://coinpedia.org/feed/',
    category: 'general', sourceTier: 'tier4', credibility: 0.62, reputation: 52,
  },
  {
    key: 'btctimes', name: 'BTC Times',
    url: 'https://www.btctimes.com/feed/',
    category: 'bitcoin', sourceTier: 'tier4', credibility: 0.65, reputation: 55,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Tier 1 + Tier 2 + Research + Geopolitical — highest signal sources */
export const HIGH_TIER_SOURCES = CRYPTO_SOURCES.filter(s =>
  s.sourceTier === 'tier1' ||
  s.sourceTier === 'tier2' ||
  s.sourceTier === 'research' ||
  s.sourceTier === 'geopolitical',
);

/** Get credibility score for a source key (fallback: 0.60) */
export function getSourceCredibility(key: string): number {
  return CRYPTO_SOURCES.find(s => s.key === key)?.credibility ?? 0.60;
}

/** Get reputation score for a source key (fallback: 50) */
export function getSourceReputation(key: string): number {
  return CRYPTO_SOURCES.find(s => s.key === key)?.reputation ?? 50;
}

/**
 * Social sentiment pre-signals — Fear & Greed Index, LunarCrush, Snapshot governance.
 * Sources: Alternative.me (free), LunarCrush (freemium), Snapshot (free).
 * Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 */

import { lunarcrush, alternative } from './adapters';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SocialMetrics {
  symbol:           string;
  name:             string;
  galaxyScore:      number;
  altRank:          number;
  socialVolume:     number;
  socialDominance:  number;
  socialScore:      number;
  tweetVolume:      number;
  redditVolume:     number;
  newsVolume:       number;
  sentiment:        number; // 0–100
  bullishPercent:   number;
  bearishPercent:   number;
  timestamp:        number;
}

export interface FearGreedIndex {
  value:                  number;
  classification:         string;
  timestamp:              number;
  previousClose:          number;
  previousClassification: string;
}

export interface FearGreedHistory {
  date:           string;
  value:          number;
  classification: string;
}

export interface TrendingToken {
  symbol:              string;
  name:                string;
  socialVolume24h:     number;
  socialVolumeChange:  number;
  sentimentScore:      number;
  priceChange24h:      number;
}

export interface GovernanceProposal {
  id:          string;
  title:       string;
  body:        string;
  state:       'active' | 'closed' | 'pending';
  author:      string;
  space:       string;
  start:       number;
  end:         number;
  choices:     string[];
  scores:      number[];
  scoresTotal: number;
  votes:       number;
  link:        string;
}

// ─── LunarCrush ──────────────────────────────────────────────────────────────

export async function getTokenSocial(symbol: string): Promise<SocialMetrics | null> {
  try {
    const data = await lunarcrush.fetch<{ data: any[] }>(`/coins/${symbol.toLowerCase()}/v1`);
    const coin = data.data?.[0];
    if (!coin) return null;

    return {
      symbol:          coin.symbol         || symbol,
      name:            coin.name           || '',
      galaxyScore:     coin.galaxy_score   || 0,
      altRank:         coin.alt_rank       || 0,
      socialVolume:    coin.social_volume  || 0,
      socialDominance: coin.social_dominance || 0,
      socialScore:     coin.social_score   || 0,
      tweetVolume:     coin.tweet_volume   || 0,
      redditVolume:    coin.reddit_volume  || 0,
      newsVolume:      coin.news_volume    || 0,
      sentiment:       coin.sentiment      || 50,
      bullishPercent:  coin.bullish_sentiment || 0,
      bearishPercent:  coin.bearish_sentiment || 0,
      timestamp:       Date.now(),
    };
  } catch {
    return null;
  }
}

export async function getTrendingSocial(limit = 20): Promise<TrendingToken[]> {
  try {
    const data = await lunarcrush.fetch<{ data: any[] }>('/coins/list/v2');
    return (data.data || []).slice(0, limit).map((coin: any) => ({
      symbol:             coin.symbol              || '',
      name:               coin.name                || '',
      socialVolume24h:    coin.social_volume       || 0,
      socialVolumeChange: coin.social_volume_change || 0,
      sentimentScore:     coin.sentiment           || 50,
      priceChange24h:     coin.price_change_24h    || 0,
    }));
  } catch {
    return [];
  }
}

export async function getBatchSocialMetrics(symbols: string[]): Promise<SocialMetrics[]> {
  const results = await Promise.allSettled(symbols.map(s => getTokenSocial(s)));
  return results
    .filter((r): r is PromiseFulfilledResult<SocialMetrics | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((m): m is SocialMetrics => m !== null);
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export async function getFearGreedIndex(): Promise<FearGreedIndex> {
  const data = await alternative.fetch<{
    data: Array<{ value: string; value_classification: string; timestamp: string }>;
  }>('/fng/?limit=2');

  const current  = data.data[0];
  const previous = data.data[1];

  return {
    value:                  parseInt(current.value),
    classification:         current.value_classification,
    timestamp:              parseInt(current.timestamp) * 1000,
    previousClose:          parseInt(previous?.value || current.value),
    previousClassification: previous?.value_classification || current.value_classification,
  };
}

export async function getFearGreedHistory(days = 30): Promise<FearGreedHistory[]> {
  const data = await alternative.fetch<{
    data: Array<{ value: string; value_classification: string; timestamp: string }>;
  }>(`/fng/?limit=${days}`);

  return (data.data || []).map(d => ({
    date:           new Date(parseInt(d.timestamp) * 1000).toISOString().split('T')[0],
    value:          parseInt(d.value),
    classification: d.value_classification,
  }));
}

// ─── Snapshot governance ──────────────────────────────────────────────────────

export async function getActiveProposals(
  space?: string,
  limit = 20,
): Promise<GovernanceProposal[]> {
  const query = `{
    proposals(
      first: ${limit},
      skip: 0,
      where: {
        state: "active",
        ${space ? `space: "${space}",` : ''}
      },
      orderBy: "created",
      orderDirection: desc
    ) {
      id title body state author
      space { id }
      start end choices scores scores_total votes quorum link
    }
  }`;

  try {
    const response = await fetch('https://hub.snapshot.org/graphql', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    if (!response.ok) return [];

    const data = await response.json() as any;
    return (data.data?.proposals || []).map((p: any) => ({
      id:          p.id,
      title:       p.title,
      body:        (p.body || '').slice(0, 500),
      state:       p.state,
      author:      p.author,
      space:       p.space?.id || '',
      start:       p.start * 1000,
      end:         p.end   * 1000,
      choices:     p.choices        || [],
      scores:      p.scores         || [],
      scoresTotal: p.scores_total   || 0,
      votes:       p.votes          || 0,
      link:        p.link || `https://snapshot.org/#/${p.space?.id}/proposal/${p.id}`,
    }));
  } catch {
    return [];
  }
}

// ─── Aggregated snapshot ──────────────────────────────────────────────────────

/**
 * Full social snapshot — Fear & Greed + BTC/ETH LunarCrush + trending.
 * Fails gracefully per source.
 */
export async function getSocialSnapshot(): Promise<{
  fearGreed:       FearGreedIndex | null;
  fearGreedHistory: FearGreedHistory[];
  btcSocial:       SocialMetrics | null;
  ethSocial:       SocialMetrics | null;
  trending:        TrendingToken[];
  activeProposals: GovernanceProposal[];
}> {
  const [fearGreed, history, btc, eth, trending, proposals] = await Promise.allSettled([
    getFearGreedIndex(),
    getFearGreedHistory(7),
    getTokenSocial('BTC'),
    getTokenSocial('ETH'),
    getTrendingSocial(10),
    getActiveProposals(undefined, 10),
  ]);

  return {
    fearGreed:        fearGreed.status  === 'fulfilled' ? fearGreed.value  : null,
    fearGreedHistory: history.status    === 'fulfilled' ? history.value    : [],
    btcSocial:        btc.status        === 'fulfilled' ? btc.value        : null,
    ethSocial:        eth.status        === 'fulfilled' ? eth.value        : null,
    trending:         trending.status   === 'fulfilled' ? trending.value   : [],
    activeProposals:  proposals.status  === 'fulfilled' ? proposals.value  : [],
  };
}

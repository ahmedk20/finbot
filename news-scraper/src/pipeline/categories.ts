/**
 * News category definitions and keyword matching.
 * Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 */

export interface Category {
  slug:        string;
  name:        string;
  description: string;
  keywords:    string[];
}

export const categories: Category[] = [
  {
    slug:        'bitcoin',
    name:        'Bitcoin',
    description: 'Bitcoin news, mining, Lightning Network, and BTC market updates',
    keywords:    ['bitcoin', 'btc', 'satoshi', 'lightning network', 'halving', 'miner', 'ordinals', 'inscription', 'sats'],
  },
  {
    slug:        'ethereum',
    name:        'Ethereum',
    description: 'Ethereum ecosystem, ETH updates, Layer 2s, and smart contracts',
    keywords:    ['ethereum', 'eth', 'vitalik', 'layer 2', 'l2', 'rollup', 'arbitrum', 'optimism', 'base', 'polygon', 'erc-20', 'erc-721', 'gas', 'gwei'],
  },
  {
    slug:        'defi',
    name:        'DeFi',
    description: 'Decentralized finance, yield farming, DEXs, and lending protocols',
    keywords:    ['defi', 'yield', 'lending', 'liquidity', 'amm', 'dex', 'aave', 'uniswap', 'compound', 'curve', 'maker', 'lido', 'staking', 'vault', 'protocol', 'tvl', 'swap'],
  },
  {
    slug:        'nft',
    name:        'NFTs',
    description: 'Non-fungible tokens, digital art, collectibles, and NFT marketplaces',
    keywords:    ['nft', 'nfts', 'opensea', 'blur', 'collectible', 'pfp', 'digital art', 'mint', 'floor price', 'bored ape', 'cryptopunk', 'azuki'],
  },
  {
    slug:        'regulation',
    name:        'Regulation',
    description: 'Crypto regulations, legal news, SEC, and government policies',
    keywords:    ['regulation', 'sec', 'cftc', 'lawsuit', 'legal', 'compliance', 'ban', 'tax', 'government', 'congress', 'law', 'court', 'enforcement', 'policy'],
  },
  {
    slug:        'altcoins',
    name:        'Altcoins',
    description: 'Alternative cryptocurrencies, tokens, and emerging projects',
    keywords:    ['solana', 'sol', 'cardano', 'ada', 'xrp', 'ripple', 'dogecoin', 'doge', 'shiba', 'avax', 'avalanche', 'dot', 'polkadot', 'bnb', 'binance', 'tron', 'near', 'cosmos', 'atom'],
  },
  {
    slug:        'trading',
    name:        'Markets',
    description: 'Market analysis, trading updates, price movements, and exchanges',
    keywords:    ['price', 'trading', 'market', 'bull', 'bear', 'rally', 'crash', 'pump', 'dump', 'exchange', 'binance', 'coinbase', 'kraken', 'futures', 'options', 'leverage', 'liquidation'],
  },
  {
    slug:        'technology',
    name:        'Technology',
    description: 'Blockchain technology, development updates, and infrastructure',
    keywords:    ['blockchain', 'protocol', 'upgrade', 'fork', 'consensus', 'proof of stake', 'proof of work', 'developer', 'github', 'mainnet', 'testnet', 'node', 'validator', 'security', 'hack', 'exploit'],
  },
  {
    slug:        'geopolitical',
    name:        'Geopolitical',
    description: 'Central bank decisions, regulations, sanctions, and geopolitical events that move crypto markets',
    keywords:    ['sanctions', 'central bank', 'federal reserve', 'fed rate', 'interest rate', 'tariff', 'war', 'conflict', 'g7', 'g20', 'treasury', 'geopolitical', 'nato', 'un'],
  },
];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find(c => c.slug === slug);
}

/**
 * Match an article's title + description against all category keywords.
 * Returns array of matching category slugs (can be multiple).
 */
export function matchArticleToCategories(title: string, description?: string): string[] {
  const text = `${title} ${description || ''}`.toLowerCase();
  return categories
    .filter(cat => cat.keywords.some(keyword => text.includes(keyword)))
    .map(cat => cat.slug);
}

/**
 * Return the single best-matching category slug, or 'general' if none.
 */
export function getPrimaryCategory(title: string, description?: string): string {
  const matches = matchArticleToCategories(title, description);
  return matches[0] ?? 'general';
}

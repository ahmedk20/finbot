import type { ChatContext } from './chat.types';

// Asset name → ticker mapping for natural language extraction.
// Checked before ticker scan so "Bitcoin" maps to BTC before we look for literal "BTC".
const NAME_TO_TICKER: Record<string, string> = {
  bitcoin:   'BTC',  btc:       'BTC',
  ethereum:  'ETH',  ether:     'ETH',  eth:       'ETH',
  solana:    'SOL',  sol:       'SOL',
  binance:   'BNB',  bnb:       'BNB',
  ripple:    'XRP',  xrp:       'XRP',
  cardano:   'ADA',  ada:       'ADA',
  avalanche: 'AVAX', avax:      'AVAX',
  dogecoin:  'DOGE', doge:      'DOGE',
  polkadot:  'DOT',  dot:       'DOT',
  polygon:   'MATIC',matic:     'MATIC',
  chainlink: 'LINK', link:      'LINK',
  uniswap:   'UNI',  uni:       'UNI',
  apple:     'AAPL', aapl:      'AAPL',
  tesla:     'TSLA', tsla:      'TSLA',
  nvidia:    'NVDA', nvda:      'NVDA',
  microsoft: 'MSFT', msft:      'MSFT',
  google:    'GOOGL',googl:     'GOOGL',
  amazon:    'AMZN', amzn:      'AMZN',
  meta:      'META',
  coinbase:  'COIN', coin:      'COIN',
};

// Extract asset ticker from a free-text message.
// Returns null if no known asset is mentioned — chat still works, just without asset filter.
export function extractAsset(message: string): string | null {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/);

  for (const word of words) {
    // Strip punctuation from word edges
    const clean = word.replace(/[^a-z0-9]/g, '');
    if (NAME_TO_TICKER[clean]) return NAME_TO_TICKER[clean];
  }

  return null;
}

// Build the LLM prompt with all fetched context embedded.
// Security note: `message` is user input — it's placed inside the prompt as a
// quoted user question, clearly separated from system instructions.
// LLM prompt injection risk is low here because:
//   1. We don't execute any LLM output as code
//   2. The LLM only returns text — no tool calls or structured commands
//   3. Max message length is 500 chars (enforced by Zod schema)
// Still: never interpolate user input into the *system* prompt section.

export function buildChatPrompt(message: string, ctx: ChatContext): string {
  const sentimentSection = ctx.asset && ctx.sentimentScore !== null
    ? `CURRENT SENTIMENT FOR ${ctx.asset}:
Score: ${ctx.sentimentScore} (${ctx.sentimentLabel})
Based on ${ctx.articleCount} articles in the last 24 hours`
    : 'No specific asset sentiment data available for this query.';

  const articlesSection = ctx.articles.length > 0
    ? ctx.articles.map((a, i) =>
        `${i + 1}. [${a.source}] ${a.title}
   Sentiment: ${a.sentiment} | Published: ${a.publishedAt}
   ${a.summary}`
      ).join('\n\n')
    : 'No recent articles found for this query.';

  return `You are FinBot, a financial intelligence assistant with access to real-time news and market sentiment data.

Answer the user's question using ONLY the context provided below. Do not use knowledge from your training data for specific facts, prices, or events — only use what is in the context.

If the context does not contain enough information to answer the question, say so clearly. Do not hallucinate facts.

Be concise (2-4 sentences), specific, and cite article sources when relevant.

---

${sentimentSection}

RECENT RELEVANT ARTICLES:
${articlesSection}

---

User question: "${message}"`;
}

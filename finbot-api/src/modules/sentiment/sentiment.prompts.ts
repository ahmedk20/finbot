// Security note: title and summary come from our own Pinecone store (news-scraper pipeline).
// They are not raw user input. Asset is validated as an uppercase ticker symbol before
// reaching this function. Sanitization strips any characters outside A-Z0-9-. to prevent
// prompt injection if input sources change in future.

const ASSET_RE = /[^A-Z0-9\-\.]/g;

export function buildSentimentPrompt(asset: string, title: string, summary: string): string {
  asset = asset.toUpperCase().replace(ASSET_RE, '');
  return `You are a financial sentiment analysis expert specializing in crypto and equity markets.

Analyze the following news article and determine its sentiment specifically for the asset: ${asset}

Article title: ${title}
Article summary: ${summary}

Respond with ONLY a JSON object in this exact format, no other text:
{
  "score": <float between -1.0 and 1.0>,
  "label": <"bullish" | "bearish" | "neutral">,
  "reasoning": <one sentence explaining your score>
}

Scoring guide:
  +0.8 to +1.0 = very bullish (major positive catalyst, adoption, partnership)
  +0.4 to +0.7 = bullish (positive news, mild upside)
  -0.3 to +0.3 = neutral (no clear directional impact)
  -0.4 to -0.7 = bearish (negative news, mild downside)
  -0.8 to -1.0 = very bearish (regulatory ban, hack, fraud, collapse)

If the article is not related to ${asset}, return score: 0, label: "neutral".`;
}

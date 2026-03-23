import { complete } from '../../shared/llm/llm.client';
import { findMany } from '../news/news.repository';
import { getAssetSentiment } from '../sentiment/sentiment.service';
import { AssetNotFound } from '../sentiment/sentiment.errors';
import { extractAsset, buildChatPrompt } from './chat.prompts';
import type { ChatInput } from './chat.schema';
import type { ChatContext, ChatResponse } from './chat.types';

const CONTEXT_ARTICLES = 5; // how many articles to include as context

export async function chat(input: ChatInput): Promise<ChatResponse> {
  // 1. Resolve asset — user override → auto-extract → null (general market question)
  const asset = input.asset ?? extractAsset(input.message);

  // 2. Fetch context in parallel — sentiment score + relevant articles
  //    Both queries are independent so we run them concurrently
  const [sentimentResult, newsResult] = await Promise.allSettled([
    asset ? getAssetSentiment(asset, { window: '24h' }) : Promise.resolve(null),
    findMany({
      query:  input.message, // semantic search: embed the user's question
      asset:  asset ?? undefined,
      hours:  24,
      limit:  CONTEXT_ARTICLES,
    }),
  ]);

  // 3. Build context object — handle partial failures gracefully
  //    If sentiment fetch fails (asset not found, no data) — continue without it
  //    If news fetch fails — continue with empty articles
  const sentiment = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
  const articles  = newsResult.status === 'fulfilled'      ? newsResult.value     : [];

  const ctx: ChatContext = {
    asset,
    sentimentScore: sentiment?.score ?? null,
    sentimentLabel: sentiment?.label ?? null,
    articleCount:   sentiment?.articleCount ?? 0,
    articles: articles.map(a => ({
      title:       a.title,
      source:      a.source,
      sentiment:   a.sentiment,
      summary:     a.summary,
      publishedAt: a.publishedAt,
    })),
  };

  // 4. Build prompt and call LLM
  const prompt   = buildChatPrompt(input.message, ctx);
  const response = await complete(
    [
      {
        role:    'system',
        content: 'You are FinBot, a financial intelligence assistant. Answer questions using only the provided context. Be concise and accurate.',
      },
      {
        role:    'user',
        content: prompt,
      },
    ],
    { temperature: 0.3, max_tokens: 400 },
    // temperature 0.3: slightly creative (natural language) but still grounded
    // 0.0 would sound robotic, 0.7+ risks hallucination
  );

  return {
    reply: response.content,
    context: {
      asset,
      sentimentScore: ctx.sentimentScore,
      articlesUsed:   ctx.articles.length,
      model:          response.model_used,
    },
  };
}

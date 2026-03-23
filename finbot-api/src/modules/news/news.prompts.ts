import type { NewsItem } from './news.types';

interface Message {
  role: 'system' | 'user';
  content: string;
}

export function buildSummaryPrompt(articles: NewsItem[], asset?: string): Message[] {
  const lines = articles.slice(0, 8).map((a, i) =>
    `${i + 1}. [${a.sentiment.toUpperCase()} / ${a.severity}] "${a.title}" — ${a.source} (${a.sourceTier})`,
  );

  return [
    {
      role: 'system',
      content:
        'You are a financial news analyst specializing in crypto markets. ' +
        'Summarize the provided articles in 2-3 concise sentences. ' +
        'Cover: dominant theme, overall sentiment direction, key risk or catalyst. ' +
        'Be factual. No financial advice. No filler phrases.',
    },
    {
      role: 'user',
      content: `Summarize these recent${asset ? ` ${asset}` : ''} news articles:\n\n${lines.join('\n')}`,
    },
  ];
}

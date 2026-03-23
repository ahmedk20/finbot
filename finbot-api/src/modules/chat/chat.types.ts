export interface ChatRequest {
  message: string;
  asset?:  string; // optional override — if not provided, auto-extracted from message
}

export interface ChatContext {
  asset:         string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  articleCount:  number;
  articles:      Array<{
    title:     string;
    source:    string;
    sentiment: string;
    summary:   string;
    publishedAt: string;
  }>;
}

export interface ChatResponse {
  reply:   string;
  context: {
    asset:         string | null;
    sentimentScore: number | null;
    articlesUsed:  number;
    model:         string;
  };
}

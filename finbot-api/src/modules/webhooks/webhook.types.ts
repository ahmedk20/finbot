export type WebhookEvent = 'sentiment_change' | 'signal_change' | 'analysis_done' | 'news_alert';

export interface WebhookRecord {
  id:        string;
  userId:    string;
  url:       string;
  asset:     string | null;
  event:     WebhookEvent;
  threshold: number | null;
  secret:    string;
  active:    boolean;
  createdAt: Date;
}

export interface WebhookPayload {
  event:     WebhookEvent;
  asset:     string;
  data:      Record<string, unknown>;
  timestamp: string;
}

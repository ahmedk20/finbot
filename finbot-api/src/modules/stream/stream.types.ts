// Payload published to Redis when a sentiment score is updated
export interface SentimentEvent {
  asset:        string;
  score:        number;
  label:        string;
  articleCount: number;
  updatedAt:    string; // ISO 8601
}

// Payload published to Redis when a new article is ingested
export interface NewsEvent {
  id:          string;
  title:       string;
  asset:       string;
  sentiment:   string;
  severity:    string;
  source:      string;
  publishedAt: string;
}

// What we store in Redis for stream token validation
export interface StreamTokenPayload {
  userId: string;
  plan:   string;
}

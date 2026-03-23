export interface UsageSummary {
  plan:   string;
  period: string; // "2026-03"
  limits: {
    perMinute: number;
    perDay:    number | null; // null = unlimited
  };
  usage: {
    today:     number;
    thisMonth: number;
  };
  quota: {
    dailyRemaining: number | null; // null = unlimited
    dailyResetAt:   string;        // ISO 8601 UTC midnight
  };
}

export interface LogUsageInput {
  userId:     string;
  endpoint:   string;
  plan:       string;
  statusCode: number;
  latency_ms: number;
}

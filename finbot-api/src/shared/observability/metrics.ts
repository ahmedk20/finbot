import { tracer } from '../../tracer';

// Thin wrapper around dd-trace dogstatsd.
// All metric names follow the convention: finbot.<service>.<noun>
// Tags follow Datadog convention: key:value (lowercase, snake_case)
const dd = tracer.dogstatsd;

export const metrics = {
  // ── API ──────────────────────────────────────────────────────────────────

  // Increment on every completed request — tagged so we can filter by plan in Datadog
  apiRequest(plan: string, endpoint: string, statusCode: number): void {
    dd.increment('finbot.api.requests', 1, [
      `plan:${plan.toLowerCase()}`,
      `endpoint:${endpoint}`,
      `status:${statusCode}`,
    ]);
  },

  // ── Sentiment ─────────────────────────────────────────────────────────────

  // Track how long the LLM sentiment job takes end-to-end (BullMQ worker)
  sentimentDuration(asset: string, durationMs: number): void {
    dd.histogram('finbot.sentiment.duration_ms', durationMs, [`asset:${asset.toLowerCase()}`]);
  },

  // Count how many sentiment scores we produce per asset (useful for coverage gaps)
  sentimentScored(asset: string): void {
    dd.increment('finbot.sentiment.scored', 1, [`asset:${asset.toLowerCase()}`]);
  },

  // ── Queue ─────────────────────────────────────────────────────────────────

  // Gauge current queue depth — call periodically so Datadog can alert on backlog
  queueDepth(queueName: string, depth: number): void {
    dd.gauge('finbot.queue.depth', depth, [`queue:${queueName}`]);
  },

  // ── Analysis ──────────────────────────────────────────────────────────────

  // Track TradingAgents job duration (these are expensive — 8-15 LLM calls)
  analysisDuration(asset: string, assetType: string, durationMs: number): void {
    dd.histogram('finbot.analysis.duration_ms', durationMs, [
      `asset:${asset.toLowerCase()}`,
      `asset_type:${assetType}`,
    ]);
  },
};

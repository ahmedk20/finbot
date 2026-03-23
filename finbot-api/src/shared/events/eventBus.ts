import { EventEmitter } from 'events';

export interface FinBotEvents {
  'news.new': { articleId: string; asset: string; sentimentScore: number; severity: string };
  'news.critical': { articleId: string; asset: string; title: string; severity: string };
  'sentiment.shift': { asset: string; previousScore: number; currentScore: number };
  'sentiment.spike': {
    asset: string;
    previousScore: number;
    currentScore: number;
    direction: 'bullish' | 'bearish';
  };
  'analysis.completed': { jobId: string; asset: string };
  'request.completed': {
    userId:     string;
    endpoint:   string;
    plan:       string;
    statusCode: number;
    latency_ms: number;
  };
  'billing.upgraded': { userId: string; previousPlan: string; newPlan: string };
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof FinBotEvents>(event: K, payload: FinBotEvents[K]): boolean {
    return super.emit(event as string, payload);
  }

  on<K extends keyof FinBotEvents>(event: K, listener: (payload: FinBotEvents[K]) => void): this {
    return super.on(event as string, listener);
  }

  once<K extends keyof FinBotEvents>(event: K, listener: (payload: FinBotEvents[K]) => void): this {
    return super.once(event as string, listener);
  }

  off<K extends keyof FinBotEvents>(event: K, listener: (payload: FinBotEvents[K]) => void): this {
    return super.off(event as string, listener);
  }
}

export const eventBus = new TypedEventBus();

// Prevent uncaught error events from crashing the process
eventBus.on('error' as never, (err: Error) => {
  console.error('EventBus error:', err);
});

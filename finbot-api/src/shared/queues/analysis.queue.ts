import { Queue } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const connection = {
  host:     new URL(env.REDIS_URL).hostname,
  port:     Number(new URL(env.REDIS_URL).port) || 6379,
  password: new URL(env.REDIS_URL).password || undefined,
};

// Separate queue from sentiment — different retry strategy, different worker concurrency.
// Analysis jobs take 15-120s each; we don't want them clogging the sentiment queue.
export const analysisQueue = new Queue('analysis', {
  connection,
  defaultJobOptions: {
    attempts: 2,                               // only retry once — TradingAgents is expensive
    backoff: { type: 'fixed', delay: 10_000 }, // 10s pause before retry
    removeOnComplete: 200,
    removeOnFail:     500,
  },
});

analysisQueue.on('error', (err) => {
  logger.error(err, 'Analysis queue error');
});

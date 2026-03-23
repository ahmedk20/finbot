import { Queue } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// BullMQ uses its own Redis connection — separate from the cache connection.
// This ensures queue operations never compete with cache reads for connections.
const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: Number(new URL(env.REDIS_URL).port) || 6379,
  password: new URL(env.REDIS_URL).password || undefined,
};

export const sentimentQueue = new Queue('sentiment', {
  connection,
  defaultJobOptions: {
    attempts:     3,                           // retry up to 3 times on failure
    backoff: {
      type:  'exponential',
      delay: 5_000,                            // 5s → 25s → 125s
    },
    removeOnComplete: 100,                     // keep last 100 completed jobs for inspection
    removeOnFail:     500,                     // keep last 500 failed jobs (dead-letter)
  },
});

sentimentQueue.on('error', (err) => {
  logger.error(err, 'Sentiment queue error');
});

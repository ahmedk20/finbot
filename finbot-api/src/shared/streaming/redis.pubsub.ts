import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Security note: pub/sub connections are SEPARATE from the cache connection.
// Once a Redis client calls subscribe(), it enters subscriber mode and can ONLY
// receive messages — it cannot run GET, SET, or any other commands.
// Mixing pub/sub with cache on one connection causes "ERR Command not allowed
// in subscribe mode" errors. Always use dedicated connections.

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required for pub/sub — don't give up on reconnect
    enableReadyCheck:     true,
    lazyConnect:          true,
  });

  client.on('error', err => logger.error(err, `Redis ${name} error`));
  client.on('connect', () => logger.info(`Redis ${name} connected`));

  return client;
}

// Publisher — regular client, used to publish events after sentiment/news updates
export const publisher = createRedisClient('publisher');

// Subscriber — dedicated subscriber client, used by SSE handlers to receive events
export const subscriber = createRedisClient('subscriber');

// Channel naming — centralised here so nothing is hardcoded in handlers
export const CHANNELS = {
  sentiment: (asset: string) => `finbot:sentiment:${asset.toUpperCase()}`,
  news:      (asset: string) => `finbot:news:${asset.toUpperCase()}`,
};

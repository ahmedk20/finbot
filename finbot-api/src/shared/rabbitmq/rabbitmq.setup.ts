/**
 * RabbitMQ bootstrap for finbot-api.
 *
 * Called once at server startup. Connects to RabbitMQ, registers all event
 * handlers, then starts consuming. Order matters:
 *   1. connect()        — establishes connection + channel + topology
 *   2. registerHandler  — register before consuming or messages may arrive unhandled
 *   3. startConsuming() — begin polling the queue
 *
 * Non-fatal: if RabbitMQ is unavailable at startup, we log and continue.
 * The reconnect logic in rabbitmq.client.ts will retry automatically.
 * Webhook delivery via RabbitMQ will be unavailable until reconnected,
 * but all HTTP endpoints remain fully functional.
 */

import { connect } from './rabbitmq.client';
import { registerHandler, startConsuming } from './rabbitmq.consumer';
import { fireWebhooks } from '../../modules/webhooks/webhook.service';
import { publisher, CHANNELS } from '../streaming/redis.pubsub';
import { logger } from '../utils/logger';
import type { FinBotEvents } from '../events/eventBus';

export async function setupRabbitMQ(): Promise<void> {
  try {
    await connect();

    // Handle news.critical — fire matching webhooks for this asset + event
    registerHandler('news.critical', async (payload: FinBotEvents['news.critical']) => {
      const data = {
        articleId: payload.articleId,
        title:     payload.title,
        severity:  payload.severity,
      };

      // 1. Fire HTTP webhooks → BUSINESS plan users who registered news_alert
      await fireWebhooks(payload.asset, 'news_alert', data);

      // 2. Publish to Redis → SSE clients watching this asset in real-time
      //    Any dashboard user subscribed to GET /stream/news/:asset receives this instantly
      await publisher.publish(CHANNELS.news(payload.asset), JSON.stringify(data));
    });

    await startConsuming();

    logger.info('RabbitMQ setup complete');
  } catch (err) {
    logger.error({ err }, 'RabbitMQ setup failed — running without message broker');
  }
}

/**
 * RabbitMQ publisher — serialize and send events to the fanout exchange.
 *
 * Why a separate publisher module?
 * The client (rabbitmq.client.ts) owns the connection lifecycle.
 * The publisher owns message formatting and delivery concerns.
 * Keeping them separate means you can test the publisher by mocking getChannel()
 * without needing a real connection.
 */

import { getChannel, EXCHANGE } from './rabbitmq.client';
import { logger } from '../utils/logger';
import type { FinBotEvents } from '../events/eventBus';

/**
 * Publish a typed FinBot event to the fanout exchange.
 *
 * persistent: true — message survives RabbitMQ restart.
 * contentType — makes debugging easier in RabbitMQ management UI.
 *
 * Fire-and-forget: we don't await delivery confirmation (publisher confirms
 * would require channel.confirmSelect() — overkill for our use case).
 */
export function publish<K extends keyof FinBotEvents>(
  event: K,
  payload: FinBotEvents[K],
): void {
  try {
    const message = JSON.stringify({ event, payload, publishedAt: new Date().toISOString() });
    const buffer  = Buffer.from(message);

    getChannel().publish(EXCHANGE, '', buffer, {
      persistent:  true,
      contentType: 'application/json',
      headers:     { 'x-event-type': event },
    });

    logger.debug({ event }, 'RabbitMQ event published');
  } catch (err) {
    // Never let publish failures crash the caller.
    // If RabbitMQ is down, log and continue — degraded is better than down.
    logger.error({ err, event }, 'RabbitMQ publish failed — event dropped');
  }
}

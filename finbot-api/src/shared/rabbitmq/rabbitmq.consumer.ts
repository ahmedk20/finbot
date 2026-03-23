/**
 * RabbitMQ consumer — reads events from the queue and dispatches to handlers.
 *
 * Key concepts:
 *
 * Manual acknowledgement (noAck: false):
 *   We call channel.ack(msg) only AFTER the handler succeeds.
 *   If the handler throws or the process crashes before ack, RabbitMQ
 *   requeues the message and redelivers it. This is "at-least-once" delivery.
 *
 *   contrast: noAck: true = "fire and forget" — message deleted immediately
 *   on delivery, even if your handler crashes. Events would be lost.
 *
 * prefetch(1):
 *   Process one message at a time. Without this, RabbitMQ floods the consumer
 *   with all queued messages at once. For webhook delivery (which calls external
 *   URLs with 10s timeouts), we want controlled concurrency.
 */

import { getChannel, QUEUE_API } from './rabbitmq.client';
import { logger } from '../utils/logger';
import type { FinBotEvents } from '../events/eventBus';

type EventMessage<K extends keyof FinBotEvents = keyof FinBotEvents> = {
  event:       K;
  payload:     FinBotEvents[K];
  publishedAt: string;
};

type Handler<K extends keyof FinBotEvents> = (payload: FinBotEvents[K]) => Promise<void>;

// Registry: event name → handler function
const handlers = new Map<keyof FinBotEvents, Handler<any>>();

/**
 * Register a handler for a specific event type.
 * Call this before startConsuming().
 */
export function registerHandler<K extends keyof FinBotEvents>(
  event:   K,
  handler: Handler<K>,
): void {
  handlers.set(event, handler);
  logger.debug({ event }, 'RabbitMQ handler registered');
}

/**
 * Start consuming messages from the queue.
 * Must be called after connect() and after all handlers are registered.
 */
export async function startConsuming(): Promise<void> {
  const ch = getChannel();

  // Process one message at a time — gives us back-pressure on external calls
  ch.prefetch(1);

  await ch.consume(QUEUE_API, async (msg) => {
    if (!msg) return; // null = consumer cancelled by broker

    let parsed: EventMessage | undefined;

    try {
      parsed = JSON.parse(msg.content.toString()) as EventMessage;
    } catch (err) {
      // Malformed JSON — nack without requeue (poison pill, don't loop forever)
      logger.error({ err, raw: msg.content.toString() }, 'RabbitMQ message parse failed — discarding');
      ch.nack(msg, false, false);
      return;
    }

    const handler = handlers.get(parsed.event);

    if (!handler) {
      // No handler registered for this event — ack and skip (don't block the queue)
      logger.warn({ event: parsed.event }, 'No handler registered — skipping');
      ch.ack(msg);
      return;
    }

    try {
      await handler(parsed.payload);
      ch.ack(msg); // success — remove from queue
    } catch (err) {
      // Handler failed — nack with requeue so RabbitMQ retries
      // In production: add a dead-letter queue after N retries to avoid infinite loops
      logger.error({ err, event: parsed.event }, 'RabbitMQ handler failed — requeueing');
      ch.nack(msg, false, true); // requeue: true
    }
  }, { noAck: false });

  logger.info({ queue: QUEUE_API }, 'RabbitMQ consumer started');
}

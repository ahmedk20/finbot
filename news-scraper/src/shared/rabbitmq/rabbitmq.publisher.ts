/**
 * RabbitMQ publisher for news-scraper.
 *
 * Mirrors finbot-api/src/shared/rabbitmq/rabbitmq.publisher.ts.
 * Both services publish to the same fanout exchange — finbot-api consumes.
 *
 * Connection is established once at startup (called from index.ts).
 * publishNewsEvent() is fire-and-forget: if RabbitMQ is down, the pipeline
 * continues — we never block article processing for message delivery.
 */

import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import pino from 'pino';
import { env } from '../../config/env';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

const EXCHANGE      = 'finbot.events';
const EXCHANGE_TYPE = 'fanout';

let connection: ChannelModel | null = null;
let channel:    Channel    | null = null;

export async function connectPublisher(): Promise<void> {
  try {
    connection = await amqplib.connect(env.RABBITMQ_URL);
    channel    = await connection.createChannel();

    await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

    logger.info({ exchange: EXCHANGE }, 'RabbitMQ publisher connected');
  } catch (err) {
    // Non-fatal: scraper continues without RabbitMQ
    logger.error({ err }, 'RabbitMQ publisher failed to connect — events will not be published');
  }
}

export async function disconnectPublisher(): Promise<void> {
  try {
    await channel?.close();
    await connection?.close();
  } catch {
    // Ignore on shutdown
  }
}

export type NewsCriticalPayload = {
  articleId:      string;
  asset:          string;
  title:          string;
  severity:       string;
  sentiment:      string;
  sentimentScore: number;
};

/**
 * Publish a news.critical event to the fanout exchange.
 * Called from the pipeline after scoring when severity === 'high'.
 */
export function publishNewsEvent(payload: NewsCriticalPayload): void {
  if (!channel) {
    logger.warn('RabbitMQ channel not ready — skipping publish');
    return;
  }

  try {
    const message = JSON.stringify({
      event:       'news.critical',
      payload,
      publishedAt: new Date().toISOString(),
    });

    channel.publish(EXCHANGE, '', Buffer.from(message), {
      persistent:  true,
      contentType: 'application/json',
      headers:     { 'x-event-type': 'news.critical' },
    });

    logger.debug({ articleId: payload.articleId, asset: payload.asset }, 'news.critical published');
  } catch (err) {
    logger.error({ err }, 'RabbitMQ publish failed — event dropped');
  }
}

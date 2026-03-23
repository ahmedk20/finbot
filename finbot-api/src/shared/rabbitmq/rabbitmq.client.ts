/**
 * RabbitMQ client — connection, channel, and topology setup.
 *
 * Design decisions:
 *
 * 1. Single connection, single channel per process.
 *    Connections are expensive (TCP + TLS handshake). Channels are lightweight
 *    multiplexed streams over a single connection. One channel is enough for
 *    low-throughput use cases like ours.
 *
 * 2. Exponential backoff reconnect.
 *    If RabbitMQ restarts or the network drops, we retry: 1s, 2s, 4s, 8s, 16s, 30s cap.
 *    Without this, a broker restart kills the consumer permanently.
 *
 * 3. Fanout exchange.
 *    We use a fanout exchange so any future service can bind its own queue
 *    and receive every event — without changing the publisher. The publisher
 *    doesn't know who's listening.
 *
 * 4. Durable queues + persistent messages.
 *    durable: true  → queue survives RabbitMQ restart (stored on disk)
 *    persistent: true → each message survives RabbitMQ restart
 *    Without both, events are lost if RabbitMQ restarts mid-flight.
 */

import amqplib, { type Connection, type Channel } from 'amqplib';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

export const EXCHANGE      = 'finbot.events';
export const EXCHANGE_TYPE = 'fanout';
export const QUEUE_API     = 'finbot.api.news';   // finbot-api binds this queue

// ─── State ────────────────────────────────────────────────────────────────────

let connection: Connection | null = null;
let channel:    Channel    | null = null;
let reconnectAttempts = 0;

// ─── Connect ──────────────────────────────────────────────────────────────────

/**
 * Establish connection + channel. Declares exchange and queue so any
 * process calling this is ready to publish or consume immediately.
 *
 * Safe to call multiple times — returns the existing channel if already open.
 */
export async function connect(): Promise<Channel> {
  if (channel) return channel;

  connection = await amqplib.connect(env.RABBITMQ_URL);
  channel    = await connection.createChannel();

  // Declare the fanout exchange — idempotent (safe to call on every startup)
  await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

  // Declare the queue finbot-api will consume from
  await channel.assertQueue(QUEUE_API, { durable: true });

  // Bind the queue to the exchange — "send everything from this exchange to this queue"
  // routingKey is ignored by fanout exchanges (we pass '' as convention)
  await channel.bindQueue(QUEUE_API, EXCHANGE, '');

  reconnectAttempts = 0;
  logger.info({ exchange: EXCHANGE, queue: QUEUE_API }, 'RabbitMQ connected');

  // Wire up error handlers so a drop triggers reconnect rather than a crash
  connection.on('error', onConnectionError);
  connection.on('close', onConnectionClose);

  return channel;
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnect(): Promise<void> {
  try {
    await channel?.close();
    await connection?.close();
  } catch {
    // Ignore errors on shutdown — process is exiting anyway
  } finally {
    channel    = null;
    connection = null;
  }
}

// ─── Reconnect with exponential backoff ───────────────────────────────────────

function onConnectionError(err: Error): void {
  logger.error({ err }, 'RabbitMQ connection error');
  scheduleReconnect();
}

function onConnectionClose(): void {
  logger.warn('RabbitMQ connection closed — will reconnect');
  scheduleReconnect();
}

function scheduleReconnect(): void {
  channel    = null;
  connection = null;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
  reconnectAttempts++;

  logger.info({ attempt: reconnectAttempts, delayMs: delay }, 'RabbitMQ reconnecting...');

  setTimeout(async () => {
    try {
      await connect();
    } catch (err) {
      logger.error({ err }, 'RabbitMQ reconnect failed');
      scheduleReconnect();
    }
  }, delay);
}

// ─── Accessor (for publish / consume) ─────────────────────────────────────────

/**
 * Returns the active channel. Throws if not connected.
 * Call connect() at app startup — never call this before connecting.
 */
export function getChannel(): Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialized. Call connect() first.');
  return channel;
}

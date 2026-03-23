import { randomBytes } from 'crypto';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../../shared/cache/l2.cache';
import { subscriber, CHANNELS } from '../../shared/streaming/redis.pubsub';
import { initSSE, writeEvent, writeHeartbeat } from '../../shared/streaming/sse';
import { ok } from '../../shared/utils/response';
import { UnauthorizedError } from '../../shared/utils/errors';
import { logger } from '../../shared/utils/logger';
import type { SentimentEvent, NewsEvent, StreamTokenPayload } from './stream.types';

const streamTokenSchema = z.object({
  userId: z.string().min(1),
  plan:   z.string().min(1),
});

const HEARTBEAT_MS  = 30_000; // 30 seconds
const TOKEN_TTL_SEC = 60;     // stream token expires in 60 seconds

// ── In-process connection registry ───────────────────────────────────────────
// One Redis subscription per channel — NOT per client.
// If 500 clients all watch BTC sentiment, there is ONE Redis subscription
// to 'finbot:sentiment:BTC'. The message fans out in-process to all 500 responses.
//
// Why this matters: each Redis subscription is a persistent TCP connection.
// Per-client subscriptions = 500 TCP connections to Redis. This pattern = 1.
// At scale, the in-process fan-out handles thousands of clients efficiently.
//
// Limitation: this only fans out within one Node.js process. Across multiple
// instances, Redis pub/sub handles it — instance 1's subscriber receives the
// message and fans out to its own clients, instance 2 does the same.

const sentimentClients = new Map<string, Set<Response>>(); // asset → connected SSE responses
const newsClients      = new Map<string, Set<Response>>();

// Register the global message handler once — handles ALL subscribed channels
subscriber.on('message', (channel: string, message: string) => {
  try {
    const data = JSON.parse(message);

    // Route to the correct in-process registry based on channel prefix
    if (channel.startsWith('finbot:sentiment:')) {
      const asset   = channel.replace('finbot:sentiment:', '');
      const clients = sentimentClients.get(asset);
      clients?.forEach(res => writeEvent(res, 'sentiment', data));
    } else if (channel.startsWith('finbot:news:')) {
      const asset   = channel.replace('finbot:news:', '');
      const clients = newsClients.get(asset);
      clients?.forEach(res => writeEvent(res, 'news', data));
    }
  } catch (err) {
    logger.warn(err, 'Failed to parse SSE message from Redis');
  }
});

// ── Token generation ─────────────────────────────────────────────────────────
// Clients cannot send custom headers with EventSource (browser SSE API limitation).
// Solution: issue a short-lived token via authenticated REST call, client uses
// that token in the query string for the SSE connection.
// Token is single-use — consumed immediately on SSE connection.
// After 60s it expires automatically via Redis TTL.
//
// Security: 32 random bytes = 256 bits of entropy — unguessable.
// Short TTL means leaked tokens are worthless quickly.

export async function generateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token: string   = randomBytes(32).toString('hex');
    const payload: StreamTokenPayload = {
      userId: req.user!.userId,
      plan:   req.user!.plan,
    };

    await redis.set(`stream:token:${token}`, JSON.stringify(payload), 'EX', TOKEN_TTL_SEC);

    res.json(ok({ token, expiresIn: TOKEN_TTL_SEC }));
  } catch (err) { next(err); }
}

// ── SSE handler helper ────────────────────────────────────────────────────────
async function startSSE(
  req:      Request,
  res:      Response,
  asset:    string,
  registry: Map<string, Set<Response>>,
  channel:  string,
): Promise<void> {
  // 1. Validate token — getdel is atomic: gets value AND deletes in one command.
  //    Prevents two requests racing to use the same token simultaneously.
  const rawToken = String(req.query.token ?? '');
  if (!rawToken) throw new UnauthorizedError('Missing stream token');

  const raw = await (redis as any).getdel(`stream:token:${rawToken}`);
  if (!raw) throw new UnauthorizedError('Invalid or expired stream token');

  // Token is now consumed — cannot be reused
  const parsed = streamTokenSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new UnauthorizedError('Malformed stream token');
  const user: StreamTokenPayload = parsed.data;

  // 2. Initialise SSE headers
  initSSE(res);

  // 3. Register this response in the in-process registry
  if (!registry.has(asset)) {
    registry.set(asset, new Set());
    // Subscribe to Redis channel only if this is the FIRST client for this asset
    // All subsequent clients share the same subscription
    await subscriber.subscribe(channel);
    logger.info({ channel }, 'SSE: subscribed to Redis channel');
  }
  registry.get(asset)!.add(res);

  logger.info({ asset, userId: user.userId }, 'SSE client connected');

  // 4. Heartbeat — keeps connection alive through proxies
  const heartbeat = setInterval(() => writeHeartbeat(res), HEARTBEAT_MS);

  // 5. Clean up when client disconnects
  req.on('close', async () => {
    clearInterval(heartbeat);
    registry.get(asset)?.delete(res);

    // If no more clients for this asset — unsubscribe from Redis to save resources
    if (registry.get(asset)?.size === 0) {
      registry.delete(asset);
      await subscriber.unsubscribe(channel);
      logger.info({ channel }, 'SSE: unsubscribed from Redis channel (no clients)');
    }

    logger.info({ asset, userId: user.userId }, 'SSE client disconnected');
  });
}

// ── Public handlers ───────────────────────────────────────────────────────────

// GET /stream/sentiment/:asset?token=xxx
export async function streamSentiment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const asset   = String(req.params.asset).toUpperCase();
    const channel = CHANNELS.sentiment(asset);
    await startSSE(req, res, asset, sentimentClients, channel);
  } catch (err) { next(err); }
}

// GET /stream/news/:asset?token=xxx
export async function streamNews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const asset   = String(req.params.asset).toUpperCase();
    const channel = CHANNELS.news(asset);
    await startSSE(req, res, asset, newsClients, channel);
  } catch (err) { next(err); }
}

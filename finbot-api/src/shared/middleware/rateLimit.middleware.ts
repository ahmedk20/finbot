import type { Request, Response, NextFunction } from 'express';
import { redis } from '../cache/l2.cache';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

// ── Per-plan limits ────────────────────────────────────────────────────────────
// Per-minute uses a sliding window (accurate, prevents burst at window edge).
// Per-day uses a fixed window (cheap — one INCR + EXPIRE, fine for daily quotas).

const PLAN_LIMITS: Record<string, { perMinute: number; perDay: number }> = {
  FREE:     { perMinute: 20,   perDay: 500   },
  STARTER:  { perMinute: 60,   perDay: 5_000  },
  PRO:      { perMinute: 200,  perDay: 50_000 },
  BUSINESS: { perMinute: 500,  perDay: -1     }, // -1 = unlimited
};

const WINDOW_MS  = 60 * 1000;       // 1 minute in ms
const WINDOW_SEC = 60;              // 1 minute in seconds (for EXPIRE)
const DAY_SEC    = 24 * 60 * 60;   // 1 day in seconds

// ── Sliding window (sorted set) ───────────────────────────────────────────────
// Score = timestamp in ms. Member = timestamp in ms (unique enough at this scale).
// On each request:
//   1. Remove members older than 1 minute
//   2. Count remaining — if >= limit → 429
//   3. Add this request
//   4. Refresh TTL

async function slidingWindowCheck(
  userId: string,
  limit: number,
): Promise<{ count: number; resetAt: number }> {
  const key = `rl:min:${userId}`;
  const now  = Date.now();
  const cutoff = now - WINDOW_MS;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, cutoff);     // remove expired
  pipeline.zcard(key);                            // count remaining
  pipeline.zadd(key, now, `${now}`);              // add current
  pipeline.expire(key, WINDOW_SEC);               // refresh TTL

  const results = await pipeline.exec();
  // zcard result is at index 1
  const count = (results?.[1]?.[1] as number) ?? 0;
  const resetAt = Math.ceil((now + WINDOW_MS) / 1000); // Unix seconds

  return { count, resetAt };
}

// ── Fixed window (INCR) ───────────────────────────────────────────────────────
async function fixedDayCheck(
  userId: string,
  limit: number,
): Promise<{ count: number }> {
  const day = new Date().toISOString().slice(0, 10); // "2026-03-15"
  const key  = `rl:day:${userId}:${day}`;

  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, DAY_SEC); // only sets if not already set → idempotent

  const results = await pipeline.exec();
  const count = (results?.[0]?.[1] as number) ?? 0;

  return { count };
}

// ── Middleware factory ────────────────────────────────────────────────────────
// Usage: router.use(rateLimit())   ← apply to all routes in a router
// Or:    router.get('/heavy', rateLimit(), handler)

export function rateLimit() {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // No req.user → auth middleware didn't run or this is a public route.
    // Allow through — auth middleware will reject unauthenticated requests separately.
    if (!req.user) { next(); return; }

    const { userId, plan } = req.user;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;

    try {
      // ── Per-minute sliding window ─────────────────────────────────────────
      const { count: minCount, resetAt } = await slidingWindowCheck(userId, limits.perMinute);

      const remaining = Math.max(0, limits.perMinute - minCount);

      // Set RFC 6585 headers on every request (not just rejections)
      res.setHeader('X-RateLimit-Limit',     limits.perMinute);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset',     resetAt);

      if (minCount > limits.perMinute) {
        const retryAfter = resetAt - Math.floor(Date.now() / 1000);
        res.setHeader('Retry-After', retryAfter);
        next(new RateLimitError()); return;
      }

      // ── Per-day fixed window ──────────────────────────────────────────────
      if (limits.perDay !== -1) {
        const { count: dayCount } = await fixedDayCheck(userId, limits.perDay);

        if (dayCount > limits.perDay) {
          // Daily quota exhausted — Retry-After = seconds until midnight UTC
          const now        = new Date();
          const midnight   = new Date(now);
          midnight.setUTCHours(24, 0, 0, 0);
          const retryAfter = Math.ceil((midnight.getTime() - now.getTime()) / 1000);

          res.setHeader('Retry-After', retryAfter);
          next(new RateLimitError()); return;
        }
      }

      next();
    } catch (err) {
      // Redis failure → allow request through (rate limiting is best-effort)
      logger.warn(err, 'Rate limit Redis check failed — allowing request');
      next();
    }
  };
}

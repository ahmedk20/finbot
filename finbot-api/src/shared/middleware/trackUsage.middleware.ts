import type { Request, Response, NextFunction } from 'express';
import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';

// Maps Express route paths to human-readable endpoint names.
// We store a name, not the raw URL, so "/news/abc123" and "/news/xyz456"
// both count as "news.byId" — not thousands of unique strings bloating the DB.
function resolveEndpoint(req: Request): string {
  const method = req.method.toLowerCase();
  const path   = req.route?.path ?? req.path; // req.route.path is the pattern ("/breaking"), not the URL

  // news routes
  if (path === '/breaking')              return 'news.breaking';
  if (path === '/' && method === 'get')  return 'news.list';
  if (path === '/:id')                   return 'news.byId';

  // auth routes (for future — we may want to track these too)
  if (path === '/keys' && method === 'get')    return 'auth.listKeys';
  if (path === '/keys' && method === 'post')   return 'auth.createKey';
  if (path.startsWith('/keys/') && method === 'delete') return 'auth.revokeKey';

  // fallback — use method + cleaned path
  return `${method}:${path}`;
}

// Attaches a 'finish' listener to the response.
// 'finish' fires after the response is fully sent to the client — zero latency impact.
// We only emit the event if req.user exists (authenticated requests only).
export function trackUsage(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (!req.user) return; // public routes — nothing to track

    const latency_ms  = Date.now() - startedAt;
    const endpoint    = resolveEndpoint(req);
    const statusCode  = res.statusCode;

    // Fire-and-forget — if the event bus or DB fails, the request already succeeded
    try {
      eventBus.emit('request.completed', {
        userId:     req.user.userId,
        endpoint,
        plan:       req.user.plan,
        statusCode,
        latency_ms,
      });
    } catch (err) {
      logger.warn(err, 'trackUsage emit failed');
    }
  });

  next(); // do NOT await — this middleware is synchronous
}

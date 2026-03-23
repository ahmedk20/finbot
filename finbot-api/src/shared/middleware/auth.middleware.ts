import { timingSafeEqual, createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../../modules/auth/auth.service';
import { verifyAccessToken } from '../../modules/auth/auth.jwt';
import { UnauthorizedError } from '../utils/errors';
import { env } from '../config/env';

// Middleware for internal service-to-service routes (X-Internal-Key header).
// Uses Node's crypto.timingSafeEqual to prevent timing attacks.
export function authenticateInternal(req: Request, _res: Response, next: NextFunction): void {
  try {
    const provided = req.headers['x-internal-key'];
    if (typeof provided !== 'string') throw new UnauthorizedError('Missing internal key');

    // timingSafeEqual requires equal-length buffers — hash both to fixed length
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(env.INTERNAL_KEY).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedError('Invalid internal key');

    next();
  } catch (err) {
    next(err);
  }
}

// Accepts either:
//   1. API key:   Authorization: Bearer fb_xxxx...
//   2. JWT cookie: access_token=<jwt>  (set by dashboard/login)
// This lets dashboard users create their first API key via the UI.
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      // API key path
      const rawKey = header.slice(7).trim();
      if (!rawKey) throw new UnauthorizedError('Missing API key');
      req.user = await validateApiKey(rawKey);
      return next();
    }

    // JWT cookie path (dashboard flow)
    const cookieToken = req.cookies?.access_token as string | undefined;
    if (cookieToken) {
      const payload = await verifyAccessToken(cookieToken).catch(() => {
        throw new UnauthorizedError('Invalid or expired session');
      });
      req.user = { userId: payload.userId, email: payload.email, plan: payload.plan as never, apiKeyId: '' };
      return next();
    }

    throw new UnauthorizedError('Missing Authorization header');
  } catch (err) {
    next(err);
  }
}

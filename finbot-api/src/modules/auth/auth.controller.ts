import type { Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema, createKeySchema } from './auth.schema';
import * as authService from './auth.service';
import { ok } from '../../shared/utils/response';
import { UnauthorizedError } from '../../shared/utils/errors';
import { validate } from '../../shared/utils/validate';
import { env } from '../../shared/config/env';

const secureCookie = env.NODE_ENV !== 'development';

// ── Controllers ───────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(registerSchema, req.body);
    const result = await authService.register(input);
    res.status(201).json(ok(result));
  } catch (err) { next(err); }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(loginSchema, req.body);
    const result = await authService.login(input);
    res.status(200).json(ok(result));
  } catch (err) { next(err); }
}

export async function createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(createKeySchema, req.body);
    // req.user is attached by auth middleware — guaranteed to exist on this route
    const result = await authService.createApiKey(req.user!.userId, input.name);
    res.status(201).json(ok(result));
  } catch (err) { next(err); }
}

export async function listApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keys = await authService.listApiKeys(req.user!.userId);
    res.json(ok(keys));
  } catch (err) { next(err); }
}

export async function revokeApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.revokeApiKey(String(req.params.id), req.user!.userId);
    res.json(ok({ message: 'API key revoked' }));
  } catch (err) { next(err); }
}

// ── Dashboard JWT controllers ─────────────────────────────────────────────────
// Used by the Next.js dashboard — not by API clients

export async function dashboardLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(loginSchema, req.body);
    const result = await authService.loginWithJwt(input);

    // httpOnly cookies — JS in the browser cannot read them (XSS protection)
    // Same pattern as food-delivery-core-service
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure:   secureCookie,
      sameSite: 'lax',
      maxAge:   15 * 60 * 1000,           // 15 minutes
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   secureCookie,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
      path:     '/api/v1/auth/dashboard/refresh',
    });

    res.json(ok({ user: result.user }));
  } catch (err) { next(err); }
}

export async function dashboardRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new UnauthorizedError('No refresh token');

    const result = await authService.refreshJwt(rawToken);

    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure:   secureCookie,
      sameSite: 'lax',
      maxAge:   15 * 60 * 1000,
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   secureCookie,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     '/api/v1/auth/dashboard/refresh',
    });

    res.json(ok({ message: 'Token refreshed' }));
  } catch (err) { next(err); }
}

export async function dashboardLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) await authService.logoutJwt(rawToken);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/v1/auth/dashboard/refresh' });
    res.json(ok({ message: 'Logged out' }));
  } catch (err) { next(err); }
}

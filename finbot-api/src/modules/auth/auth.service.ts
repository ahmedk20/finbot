import * as authRepo from './auth.repository';
import { hashPassword, comparePassword, generateApiKey, hashApiKey } from './auth.utils';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.jwt';
import { createHash } from 'crypto';
import { logger } from '../../shared/utils/logger';
import {
  UserAlreadyExists, InvalidCredentials, InvalidApiKey,
  ApiKeyNotFound, KeyLimitReached,
} from './auth.errors';
import type { RegisterInput, LoginInput } from './auth.schema';
import type { AuthUser, CreatedApiKey } from './auth.types';
import { env } from '../../shared/config/env';

// Max API keys per plan
const KEY_LIMITS: Record<string, number> = {
  FREE: 1, STARTER: 3, PRO: 10, BUSINESS: 50,
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function register(input: RegisterInput) {
  const existing = await authRepo.findUserByEmail(input.email);
  if (existing) throw UserAlreadyExists();

  const passwordHash = await hashPassword(input.password);
  const user = await authRepo.createUser({ ...input, passwordHash });

  return { user };
}

export async function login(input: LoginInput) {
  const user = await authRepo.findUserByEmail(input.email);

  // Always compare even if user doesn't exist — prevents timing attacks
  // that reveal whether an email is registered
  // Valid bcrypt hash of a fixed placeholder — ensures comparePassword always runs
  // (constant time) regardless of whether the user exists, preventing timing attacks.
  const dummyHash = '$2b$12$LvuqPCPm1HQe6dn8JCwFwOIkZDCdFPBNElJSsbcHkTHAHPWvReq8e';
  const match = await comparePassword(input.password, user?.password ?? dummyHash);

  if (!user || !match) throw InvalidCredentials();

  return {
    user: { id: user.id, email: user.email, plan: user.plan, createdAt: user.createdAt },
  };
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function createApiKey(userId: string, name?: string): Promise<CreatedApiKey> {
  const user = await authRepo.findUserById(userId);
  if (!user) throw InvalidCredentials();

  const activeKeys = await authRepo.countActiveKeys(userId);
  const limit = KEY_LIMITS[user.plan] ?? 1;
  if (activeKeys >= limit) throw KeyLimitReached();

  const { fullKey, prefix, hash } = generateApiKey();
  const record = await authRepo.createApiKey({ userId, keyHash: hash, prefix, name });

  return { id: record.id, fullKey, prefix, name: record.name, createdAt: record.createdAt };
  // fullKey leaves this function once — never stored, shown to user once in the response
}

export async function listApiKeys(userId: string) {
  return authRepo.listApiKeys(userId);
}

export async function revokeApiKey(keyId: string, userId: string) {
  const result = await authRepo.revokeApiKey(keyId, userId);
  if (result.count === 0) throw ApiKeyNotFound();
}

// ── Dashboard JWT Auth ────────────────────────────────────────────────────────
// Concept: access token (15m) + refresh token (7d)
// Access token is stateless — validated by signature alone (no DB lookup)
// Refresh token is stored hashed in DB — revoked on use (rotation pattern)

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function refreshExpiresAt(): Date {
  // Parse "7d" → Date 7 days from now
  const days = parseInt(env.JWT_REFRESH_EXPIRES_IN, 10);
  const ms   = (isNaN(days) ? 7 : days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

export async function loginWithJwt(input: LoginInput) {
  const user = await authRepo.findUserByEmail(input.email);

  // Valid bcrypt hash of a fixed placeholder — ensures comparePassword always runs
  // (constant time) regardless of whether the user exists, preventing timing attacks.
  const dummyHash = '$2b$12$LvuqPCPm1HQe6dn8JCwFwOIkZDCdFPBNElJSsbcHkTHAHPWvReq8e';
  const match = await comparePassword(input.password, user?.password ?? dummyHash);
  if (!user || !match) throw InvalidCredentials();

  const payload      = { userId: user.id, email: user.email, plan: user.plan };
  const accessToken  = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);

  await authRepo.createRefreshToken({
    userId:    user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiresAt(),
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, plan: user.plan },
  };
}

export async function refreshJwt(rawRefreshToken: string) {
  // 1. Verify signature — catches expired/tampered tokens immediately
  const payload = await verifyRefreshToken(rawRefreshToken).catch(() => { throw InvalidCredentials(); });

  // 2. Check DB — ensures token hasn't been revoked
  const hash   = hashToken(rawRefreshToken);
  const record = await authRepo.findRefreshTokenByHash(hash);
  if (!record || record.revokedAt || record.expiresAt < new Date()) throw InvalidCredentials();

  // 3. Rotate — revoke old token, issue new pair
  // If an attacker steals a refresh token and uses it, the legitimate user's
  // next refresh will fail (token already revoked), alerting them to re-login
  await authRepo.revokeRefreshToken(record.id);

  const newPayload      = { userId: payload.userId, email: payload.email, plan: payload.plan };
  const newAccessToken  = await signAccessToken(newPayload);
  const newRefreshToken = await signRefreshToken(newPayload);

  await authRepo.createRefreshToken({
    userId:    payload.userId,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: refreshExpiresAt(),
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export async function logoutJwt(rawRefreshToken: string) {
  const hash   = hashToken(rawRefreshToken);
  const record = await authRepo.findRefreshTokenByHash(hash);
  if (record && !record.revokedAt) await authRepo.revokeRefreshToken(record.id);
  // No error if token not found — logout should always succeed from user's perspective
}

// ── Key Validation (called by auth middleware on every request) ───────────────

export async function validateApiKey(rawKey: string): Promise<AuthUser> {
  const hash   = hashApiKey(rawKey);
  const record = await authRepo.findApiKeyByHash(hash);

  if (!record || record.revokedAt) throw InvalidApiKey();

  // Update lastUsedAt in background — don't make the user wait for it
  void authRepo.touchApiKey(record.id).catch(err => logger.warn(err, 'Failed to touch API key'));

  return {
    userId:   record.user.id,
    email:    record.user.email,
    plan:     record.user.plan,
    apiKeyId: record.id,
  };
}

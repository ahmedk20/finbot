import { prisma } from '../../shared/db/postgres.client';
import type { RegisterInput } from './auth.schema';

// ── User ──────────────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function createUser(data: RegisterInput & { passwordHash: string }) {
  return prisma.user.create({
    data: { email: data.email, password: data.passwordHash },
    select: { id: true, email: true, plan: true, createdAt: true },
  });
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function createApiKey(data: { userId: string; keyHash: string; prefix: string; name?: string }) {
  return prisma.apiKey.create({
    data: { userId: data.userId, keyHash: data.keyHash, prefix: data.prefix, name: data.name },
    select: { id: true, prefix: true, name: true, createdAt: true },
  });
}

export async function findApiKeyByHash(keyHash: string) {
  return prisma.apiKey.findUnique({
    where:   { keyHash },
    include: { user: { select: { id: true, email: true, plan: true } } },
  });
}

export async function listApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where:   { userId, revokedAt: null },
    select:  { id: true, prefix: true, name: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeApiKey(id: string, userId: string) {
  // userId check ensures a user can only revoke their own keys
  return prisma.apiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}

export async function touchApiKey(id: string) {
  // Fire-and-forget — update lastUsedAt without blocking the request
  return prisma.apiKey.update({
    where: { id },
    data:  { lastUsedAt: new Date() },
  }).catch(() => { /* non-fatal */ });
}

export async function countActiveKeys(userId: string) {
  return prisma.apiKey.count({ where: { userId, revokedAt: null } });
}

// ── Refresh Tokens (dashboard JWT sessions) ───────────────────────────────────

export async function createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
  return prisma.refreshToken.create({ data });
}

export async function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({
    where:   { tokenHash },
    include: { user: { select: { id: true, email: true, plan: true } } },
  });
}

export async function revokeRefreshToken(id: string) {
  return prisma.refreshToken.update({
    where: { id },
    data:  { revokedAt: new Date() },
  });
}

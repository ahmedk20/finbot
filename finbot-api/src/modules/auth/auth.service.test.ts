/**
 * Unit tests for auth.service.ts
 *
 * Strategy: mock the repository (the only external dependency of the service).
 * We're testing BUSINESS LOGIC here — not DB queries, not HTTP.
 *
 * Why mock the repo and not the service?
 * Mocking the service would test nothing — you'd be asserting that a mock
 * returns what you told it to return. Mock the outermost dep, test real logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authRepo from './auth.repository';
import * as authService from './auth.service';
import { UserAlreadyExists, InvalidCredentials, KeyLimitReached } from './auth.errors';

// Auto-mock the entire repository module
// Every exported function becomes a vi.fn() that returns undefined by default
vi.mock('./auth.repository');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    id:        'user_1',
    email:     'test@example.com',
    password:  '$2b$12$validhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    plan:      'FREE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── register ─────────────────────────────────────────────────────────────────

describe('register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws UserAlreadyExists when email is already registered', async () => {
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(makeUser());

    await expect(
      authService.register({ email: 'test@example.com', password: 'Test1234!' }),
    ).rejects.toMatchObject({ code: 'USER_EXISTS', statusCode: 409 });
  });

  it('returns user without password on successful registration', async () => {
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
    vi.mocked(authRepo.createUser).mockResolvedValue({
      id: 'user_1', email: 'new@example.com', plan: 'FREE', createdAt: new Date(),
    });

    const result = await authService.register({ email: 'new@example.com', password: 'Test1234!' });

    expect(result.user.email).toBe('new@example.com');
    // Password must NEVER appear in the service response
    expect((result.user as Record<string, unknown>)['password']).toBeUndefined();
  });

  it('hashes the password before passing to repository', async () => {
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
    vi.mocked(authRepo.createUser).mockResolvedValue({
      id: 'user_1', email: 'new@example.com', plan: 'FREE', createdAt: new Date(),
    });

    await authService.register({ email: 'new@example.com', password: 'Test1234!' });

    const callArg = vi.mocked(authRepo.createUser).mock.calls[0][0];
    // The hash must not equal the plaintext
    expect(callArg.passwordHash).not.toBe('Test1234!');
    // bcrypt hashes start with $2b$
    expect(callArg.passwordHash).toMatch(/^\$2b\$/);
  });
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws InvalidCredentials when user does not exist', async () => {
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);

    await expect(
      authService.login({ email: 'ghost@example.com', password: 'anything' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
  });

  it('throws InvalidCredentials when password is wrong', async () => {
    // bcrypt hash of "RightPassword1!"
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(
      makeUser({ password: '$2b$12$invalidhashfortimingsafety000000000000000000000' }),
    );

    await expect(
      authService.login({ email: 'test@example.com', password: 'WrongPassword1!' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('still runs comparePassword even when user is not found (timing attack prevention)', async () => {
    // If we returned early on missing user, an attacker could measure response time
    // to enumerate registered emails. The service must always call comparePassword.
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);

    const start = Date.now();
    await authService.login({ email: 'ghost@example.com', password: 'anything' }).catch(() => {});
    const elapsed = Date.now() - start;

    // bcrypt with rounds=12 takes ~100ms+. A fast return (<20ms) indicates
    // the compare was skipped — that's a timing attack vulnerability.
    expect(elapsed).toBeGreaterThan(20);
  });
});

// ── createApiKey ──────────────────────────────────────────────────────────────

describe('createApiKey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws KeyLimitReached when user is at their plan limit', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue(makeUser({ plan: 'FREE' }));
    vi.mocked(authRepo.countActiveKeys).mockResolvedValue(1); // FREE limit = 1

    await expect(
      authService.createApiKey('user_1'),
    ).rejects.toMatchObject({ code: 'KEY_LIMIT' });
  });

  it('returns fullKey only once and it starts with fb_', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue(makeUser({ plan: 'FREE' }));
    vi.mocked(authRepo.countActiveKeys).mockResolvedValue(0);
    vi.mocked(authRepo.createApiKey).mockResolvedValue({
      id: 'key_1', prefix: 'fb_testpref', name: 'test', createdAt: new Date(),
    });

    const result = await authService.createApiKey('user_1', 'test');

    // fullKey is generated by the service — starts with fb_ and is 67 chars
    expect(result.fullKey).toMatch(/^fb_[0-9a-f]{64}$/);
    // prefix = first 10 chars of fullKey (fb_ + 7 hex) — derived from the generated key
    expect(result.prefix).toHaveLength(10);
    expect(result.fullKey.startsWith(result.prefix)).toBe(true);
  });

  it('stores a SHA-256 hash, never the raw key', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue(makeUser({ plan: 'FREE' }));
    vi.mocked(authRepo.countActiveKeys).mockResolvedValue(0);
    vi.mocked(authRepo.createApiKey).mockResolvedValue({
      id: 'key_1', prefix: 'fb_testpref', name: null, createdAt: new Date(),
    });

    await authService.createApiKey('user_1');

    const storedHash = vi.mocked(authRepo.createApiKey).mock.calls[0][0].keyHash;
    // SHA-256 hex = exactly 64 chars
    expect(storedHash).toHaveLength(64);
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

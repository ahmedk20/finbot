import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

const SALT_ROUNDS = 12;

// ── Passwords — bcrypt (slow by design, prevents brute-force) ─────────────────

export const hashPassword    = (plain: string)             => bcrypt.hash(plain, SALT_ROUNDS);
export const comparePassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// ── API keys — SHA-256 (fast, safe for high-entropy random keys) ──────────────
// We use SHA-256 here, not bcrypt, because:
// - API keys are 32 random bytes = 256-bit entropy (brute-force is impossible)
// - bcrypt would add 100-200ms latency to EVERY authenticated request
// - SHA-256 is cryptographically secure for already-random inputs

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// Generate a new API key
// Format: fb_<64 hex chars>  (67 chars total)
// Prefix: first 10 chars — safe to display in dashboard
export function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const fullKey = `fb_${randomBytes(32).toString('hex')}`;
  const prefix  = fullKey.slice(0, 10);
  const hash    = hashApiKey(fullKey);
  return { fullKey, prefix, hash };
}

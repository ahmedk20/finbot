/**
 * Article deduplication — two strategies:
 *
 * 1. URL hash dedup (seenUrls Set) — prevents the same article being
 *    upserted to Pinecone more than once per scraper run.
 *
 * 2. In-flight request dedup — prevents duplicate concurrent HTTP
 *    requests to the same RSS feed during parallel scraping.
 *    Adapted from free-crypto-news (github.com/nirholas/free-crypto-news).
 */

import { createHash } from 'crypto';

// ─── 1. URL hash dedup ────────────────────────────────────────────────────────

/** Stable hash of a URL — used as Pinecone vector ID */
export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * In-memory seen-URL set for a single scraper run.
 * Call reset() at the start of each cron job.
 */
const seenUrls = new Set<string>();

export function hasSeen(url: string): boolean {
  return seenUrls.has(url);
}

export function markSeen(url: string): void {
  seenUrls.add(url);
}

export function resetSeen(): void {
  seenUrls.clear();
}

export function seenCount(): number {
  return seenUrls.size;
}

// ─── 2. In-flight request dedup ──────────────────────────────────────────────

const pendingRequests = new Map<string, Promise<unknown>>();

/**
 * Deduplicate async operations by key.
 * If the same key is requested while a fetch is in-flight, the existing
 * promise is returned instead of issuing a duplicate HTTP request.
 */
export async function dedupe<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = fn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

export function getPendingCount(): number {
  return pendingRequests.size;
}

export function clearPending(): void {
  pendingRequests.clear();
}

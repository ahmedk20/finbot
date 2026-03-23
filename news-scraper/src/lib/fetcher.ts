/**
 * FinBot — Hardened HTTP Fetcher
 *
 * Adapted from crypto-vision (github.com/nirholas/crypto-vision).
 *
 * Features:
 *  - Circuit breaker per upstream host (prevents cascading failures)
 *  - Automatic retries with exponential backoff + jitter
 *  - Timeout enforcement
 *  - Rate-limit aware (respects 429 Retry-After headers)
 *  - Per-host concurrency limiting
 *
 * Circuit breaker states:
 *  CLOSED   → normal operation
 *  OPEN     → host has failed CB_THRESHOLD times — all requests rejected instantly
 *  HALF-OPEN → probing after CB_RESET_MS — if CB_HALF_OPEN_SUCCESSES succeed, closes again
 */

import pino from 'pino';

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type CBState = 'closed' | 'open' | 'half-open';

interface CircuitBreaker {
  state:                  CBState;
  failures:               number;
  lastFailure:            number;
  successesSinceHalfOpen: number;
}

const CB_THRESHOLD          = Number(process.env.CB_FAILURE_THRESHOLD || 5);
const CB_RESET_MS           = Number(process.env.CB_RESET_MS          || 30_000);
const CB_HALF_OPEN_SUCCESSES = 2;

const breakers = new Map<string, CircuitBreaker>();

function getBreaker(host: string): CircuitBreaker {
  let cb = breakers.get(host);
  if (!cb) {
    cb = { state: 'closed', failures: 0, lastFailure: 0, successesSinceHalfOpen: 0 };
    breakers.set(host, cb);
  }
  // Auto-transition open → half-open after reset window
  if (cb.state === 'open' && Date.now() - cb.lastFailure > CB_RESET_MS) {
    cb.state = 'half-open';
    cb.successesSinceHalfOpen = 0;
    logger.info({ host }, 'Circuit breaker → half-open');
  }
  return cb;
}

function recordSuccess(host: string): void {
  const cb = getBreaker(host);
  if (cb.state === 'half-open') {
    cb.successesSinceHalfOpen++;
    if (cb.successesSinceHalfOpen >= CB_HALF_OPEN_SUCCESSES) {
      cb.state    = 'closed';
      cb.failures = 0;
      logger.info({ host }, 'Circuit breaker → closed');
    }
  } else {
    cb.failures = Math.max(0, cb.failures - 1); // decay on success
  }
}

function recordFailure(host: string): void {
  const cb = getBreaker(host);
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= CB_THRESHOLD) {
    cb.state = 'open';
    logger.warn({ host, failures: cb.failures }, 'Circuit breaker → OPEN');
  }
}

// ─── Per-Host Concurrency Limiter ─────────────────────────────────────────────

const MAX_CONCURRENT_PER_HOST = Number(process.env.FETCH_CONCURRENCY_PER_HOST || 10);
const hostInflight = new Map<string, number>();
const hostQueue    = new Map<string, Array<() => void>>();

async function acquireSlot(host: string): Promise<void> {
  const current = hostInflight.get(host) || 0;
  if (current < MAX_CONCURRENT_PER_HOST) {
    hostInflight.set(host, current + 1);
    return;
  }
  return new Promise<void>(resolve => {
    let queue = hostQueue.get(host);
    if (!queue) { queue = []; hostQueue.set(host, queue); }
    queue.push(resolve);
  });
}

function releaseSlot(host: string): void {
  const queue = hostQueue.get(host);
  if (queue && queue.length > 0) {
    queue.shift()!();
  } else {
    const current = hostInflight.get(host) || 1;
    hostInflight.set(host, Math.max(0, current - 1));
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchOptions {
  timeout?: number;                    // ms (default: 10_000)
  retries?: number;                    // (default: 2)
  headers?: Record<string, string>;
  method?:  'GET' | 'POST';
  body?:    unknown;                   // auto JSON-serialized
  skipCircuitBreaker?: boolean;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public host:   string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

// ─── Core ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch JSON from an upstream API with circuit breaker, retries,
 * per-host concurrency limiting, and timeout enforcement.
 */
export async function fetchJSON<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const {
    timeout  = 10_000,
    retries  = 2,
    headers  = {},
    method   = 'GET',
    body,
    skipCircuitBreaker = false,
  } = opts;

  const host = new URL(url).hostname;

  // Circuit breaker gate
  if (!skipCircuitBreaker) {
    const cb = getBreaker(host);
    if (cb.state === 'open') {
      throw new FetchError(`Circuit open for ${host} — skipping request`, 503, host);
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquireSlot(host);

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        signal:  controller.signal,
        headers: {
          Accept:           'application/json',
          'User-Agent':     'FinBot/1.0',
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      clearTimeout(timer);
      releaseSlot(host);

      // Rate limited — back off and retry
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') || '5');
        logger.warn({ host, retryAfter }, 'Rate limited — backing off');
        await sleep(retryAfter * 1_000);
        continue;
      }

      if (!res.ok) {
        recordFailure(host);
        throw new FetchError(`HTTP ${res.status}`, res.status, host);
      }

      recordSuccess(host);
      return (await res.json()) as T;

    } catch (err) {
      clearTimeout(timer);
      releaseSlot(host);
      lastError = err as Error;

      // Circuit already open — don't retry
      if ((err as FetchError).status === 503 && (err as FetchError).name === 'FetchError') {
        throw err;
      }

      recordFailure(host);

      if (attempt < retries) {
        const base   = Math.min(1_000 * 2 ** attempt, 8_000);
        const jitter = Math.random() * base * 0.3;
        logger.debug({ host, attempt, backoffMs: Math.round(base + jitter) }, 'Retrying fetch');
        await sleep(base + jitter);
      }
    }
  }

  logger.error({ host, error: lastError?.message }, 'Fetch failed after all retries');
  throw lastError;
}

// ─── Observability helpers (used by health endpoint in Phase 3) ───────────────

/** Returns true if the circuit is open for a given host. */
export function isCircuitOpen(host: string): boolean {
  return getBreaker(host).state === 'open';
}

/** Snapshot of all circuit breaker states — for /health endpoint. */
export function circuitBreakerStats(): Record<string, { state: CBState; failures: number }> {
  const out: Record<string, { state: CBState; failures: number }> = {};
  for (const [host, cb] of breakers) {
    out[host] = { state: cb.state, failures: cb.failures };
  }
  return out;
}

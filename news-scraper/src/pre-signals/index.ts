/**
 * Pre-signals orchestrator — collects a full market context snapshot.
 *
 * Runs every 30 minutes via cron (market context changes faster than news).
 * Stores the result in-memory as `latestSnapshot` — any module in this
 * process can call getLatestSnapshot() to get current market context instantly.
 *
 * NOTE: When the API server is added (Phase 3), this moves to Redis so both
 * processes share the same snapshot. For now, single-process in-memory is fine.
 *
 * Uses Promise.allSettled — if one source fails (e.g. Glassnode is down),
 * the other two still succeed. Failed sources are stored as null.
 */

import pino from 'pino';
import { getOnChainSnapshot } from './onchain';
import { getDerivativesSnapshot } from './derivatives';
import { getSocialSnapshot } from './social';
import { getMacroSnapshot } from './macro';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  collectedAt:  string;
  onchain:      Awaited<ReturnType<typeof getOnChainSnapshot>>     | null;
  derivatives:  Awaited<ReturnType<typeof getDerivativesSnapshot>> | null;
  social:       Awaited<ReturnType<typeof getSocialSnapshot>>      | null;
  macro:        Awaited<ReturnType<typeof getMacroSnapshot>>       | null;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

let latestSnapshot: MarketSnapshot | null = null;

/** Returns the most recent market snapshot, or null if none collected yet. */
export function getLatestSnapshot(): MarketSnapshot | null {
  return latestSnapshot;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: true } } });

export async function runPreSignals(): Promise<void> {
  logger.info('Pre-signals snapshot starting...');
  const start = Date.now();

  // Run all four sources in parallel — a failure in one doesn't block the others
  const [onchain, derivatives, social, macro] = await Promise.allSettled([
    getOnChainSnapshot(),
    getDerivativesSnapshot(),
    getSocialSnapshot(),
    getMacroSnapshot(),
  ]);

  latestSnapshot = {
    collectedAt:  new Date().toISOString(),
    onchain:      onchain.status     === 'fulfilled' ? onchain.value     : null,
    derivatives:  derivatives.status === 'fulfilled' ? derivatives.value : null,
    social:       social.status      === 'fulfilled' ? social.value      : null,
    macro:        macro.status       === 'fulfilled' ? macro.value       : null,
  };

  if (onchain.status     === 'rejected') logger.warn({ err: onchain.reason },     'onchain snapshot failed');
  if (derivatives.status === 'rejected') logger.warn({ err: derivatives.reason }, 'derivatives snapshot failed');
  if (social.status      === 'rejected') logger.warn({ err: social.reason },      'social snapshot failed');
  if (macro.status       === 'rejected') logger.warn({ err: macro.reason },       'macro snapshot failed');

  logger.info(
    {
      durationMs:  Date.now() - start,
      onchain:     onchain.status     === 'fulfilled' ? 'ok' : 'failed',
      derivatives: derivatives.status === 'fulfilled' ? 'ok' : 'failed',
      social:      social.status      === 'fulfilled' ? 'ok' : 'failed',
      macro:       macro.status       === 'fulfilled' ? 'ok' : 'failed',
    },
    'Pre-signals snapshot complete',
  );
}

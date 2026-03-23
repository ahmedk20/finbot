import { eventBus } from '../../shared/events/eventBus';
import { logger } from '../../shared/utils/logger';
import * as usageRepo from './usage.repository';
import type { LogUsageInput, UsageSummary } from './usage.types';

// Plan limits duplicated here intentionally — service owns the business rules,
// not the middleware. The middleware table is for enforcement; this is for display.
const PLAN_LIMITS: Record<string, { perMinute: number; perDay: number | null }> = {
  FREE:     { perMinute: 20,  perDay: 500    },
  STARTER:  { perMinute: 60,  perDay: 5_000  },
  PRO:      { perMinute: 200, perDay: 50_000 },
  BUSINESS: { perMinute: 500, perDay: null   }, // null = unlimited
};

// Called by the event bus listener — writes to DB in the background
export async function logRequest(input: LogUsageInput): Promise<void> {
  await usageRepo.logRequest(input);
}

// Returns the full usage summary for the /usage endpoint
export async function getSummary(userId: string, plan: string): Promise<UsageSummary> {
  const now       = new Date();
  const limits    = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;

  // Today: midnight UTC → now
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // This month: first day of month → now
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Run both counts in parallel — independent queries, no reason to run sequentially
  const [todayCount, monthCount] = await Promise.all([
    usageRepo.countRequests(userId, todayStart, now),
    usageRepo.countRequests(userId, monthStart, now),
  ]);

  // Daily reset = next midnight UTC
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);

  const dailyRemaining = limits.perDay === null
    ? null
    : Math.max(0, limits.perDay - todayCount);

  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  return {
    plan,
    period,
    limits: {
      perMinute: limits.perMinute,
      perDay:    limits.perDay,
    },
    usage: {
      today:     todayCount,
      thisMonth: monthCount,
    },
    quota: {
      dailyRemaining,
      dailyResetAt: midnight.toISOString(),
    },
  };
}

// Register event bus listener — called once at app startup
// Keeps the listener registration inside the module that owns it
export function registerListeners(): void {
  eventBus.on('request.completed', async (payload) => {
    try {
      await logRequest(payload);
    } catch (err) {
      // Never crash the process over a usage log failure
      logger.warn(err, 'Failed to write usage log');
    }
  });
}

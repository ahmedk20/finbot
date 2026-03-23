/**
 * Unit tests — usage.service.ts
 *
 * Tests plan limits, quota calculation, and time window logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as usageRepo from './usage.repository';
import { getSummary } from './usage.service';

vi.mock('./usage.repository');
vi.mock('../../shared/events/eventBus', () => ({
  eventBus: { on: vi.fn(), emit: vi.fn() },
}));

describe('getSummary — plan limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns correct limits for FREE plan', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'FREE');

    expect(result.limits.perMinute).toBe(20);
    expect(result.limits.perDay).toBe(500);
  });

  it('returns correct limits for STARTER plan', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'STARTER');

    expect(result.limits.perMinute).toBe(60);
    expect(result.limits.perDay).toBe(5_000);
  });

  it('returns correct limits for PRO plan', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'PRO');

    expect(result.limits.perMinute).toBe(200);
    expect(result.limits.perDay).toBe(50_000);
  });

  it('returns null perDay for BUSINESS plan (unlimited)', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'BUSINESS');

    expect(result.limits.perDay).toBeNull();
    expect(result.quota.dailyRemaining).toBeNull();
  });
});

describe('getSummary — quota calculation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes dailyRemaining as limit minus today count', async () => {
    // First call = today count, second = month count
    vi.mocked(usageRepo.countRequests)
      .mockResolvedValueOnce(150)  // today
      .mockResolvedValueOnce(3200); // this month

    const result = await getSummary('user_1', 'FREE');

    expect(result.usage.today).toBe(150);
    expect(result.quota.dailyRemaining).toBe(350); // 500 - 150
  });

  it('clamps dailyRemaining at 0 when over limit', async () => {
    vi.mocked(usageRepo.countRequests)
      .mockResolvedValueOnce(600)  // over 500 limit
      .mockResolvedValueOnce(600);

    const result = await getSummary('user_1', 'FREE');

    expect(result.quota.dailyRemaining).toBe(0);
  });

  it('period format is YYYY-MM', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'FREE');

    expect(result.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('dailyResetAt is next midnight UTC (ISO string)', async () => {
    vi.mocked(usageRepo.countRequests).mockResolvedValue(0);

    const result = await getSummary('user_1', 'FREE');

    const resetDate = new Date(result.quota.dailyResetAt);
    expect(resetDate.getUTCHours()).toBe(0);
    expect(resetDate.getUTCMinutes()).toBe(0);
    expect(resetDate.getUTCSeconds()).toBe(0);
    // Reset must be in the future
    expect(resetDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('runs both count queries in parallel', async () => {
    const callOrder: number[] = [];
    vi.mocked(usageRepo.countRequests)
      .mockImplementation(async (_userId, from) => {
        callOrder.push(from.getTime());
        return 0;
      });

    await getSummary('user_1', 'PRO');

    // Both queries called — we don't care about order (parallel)
    expect(vi.mocked(usageRepo.countRequests)).toHaveBeenCalledTimes(2);
  });
});

/**
 * Unit tests — billing.service.ts
 *
 * Tests plan rank logic, webhook event routing, and Stripe customer creation.
 * Mocks Prisma and the billing provider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhookEvent } from './billing.service';
import { prisma } from '../../shared/db/postgres.client';
import type { NormalizedBillingEvent } from './billing.interface';

vi.mock('../../shared/db/postgres.client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      findFirst:         vi.fn(),
      update:            vi.fn(),
      updateMany:        vi.fn(),
    },
  },
}));

vi.mock('./billing.factory', () => ({
  getBillingProvider: vi.fn(() => ({
    getOrCreateCustomer:   vi.fn().mockResolvedValue('cus_test123'),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://stripe.com/pay', sessionId: 'cs_test' }),
    createPortalSession:   vi.fn().mockResolvedValue({ url: 'https://stripe.com/portal' }),
    verifyAndParseWebhook: vi.fn(),
  })),
}));

function makeEvent(overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
  return {
    type:           'subscription.activated',
    customerId:     'cus_test123',
    subscriptionId: 'sub_test123',
    plan:           'PRO',
    raw:            {},
    ...overrides,
  };
}

describe('handleWebhookEvent — subscription.activated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upgrades user plan via updateMany (matched by customerId)', async () => {
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });

    await handleWebhookEvent(makeEvent({ type: 'subscription.activated', plan: 'PRO' }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_test123' },
      data:  { plan: 'PRO', stripeSubId: 'sub_test123' },
    });
  });
});

describe('handleWebhookEvent — subscription.updated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates plan when rank changes (upgrade)', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'u1', plan: 'FREE', stripeCustomerId: 'cus_test123',
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await handleWebhookEvent(makeEvent({ type: 'subscription.updated', plan: 'PRO' }));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data:  { plan: 'PRO', stripeSubId: 'sub_test123' },
    });
  });

  it('skips update when plan rank is unchanged', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'u1', plan: 'PRO', stripeCustomerId: 'cus_test123',
    } as any);

    await handleWebhookEvent(makeEvent({ type: 'subscription.updated', plan: 'PRO' }));

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('handles downgrade (PRO → STARTER)', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'u1', plan: 'PRO', stripeCustomerId: 'cus_test123',
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await handleWebhookEvent(makeEvent({ type: 'subscription.updated', plan: 'STARTER' }));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data:  { plan: 'STARTER', stripeSubId: 'sub_test123' },
    });
  });
});

describe('handleWebhookEvent — subscription.cancelled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downgrades user to FREE and clears stripeSubId', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'u1', plan: 'PRO', stripeCustomerId: 'cus_test123',
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await handleWebhookEvent(makeEvent({ type: 'subscription.cancelled', plan: 'FREE' }));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data:  { plan: 'FREE', stripeSubId: null },
    });
  });

  it('does not throw when user is not found (safe for deleted accounts)', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    await expect(
      handleWebhookEvent(makeEvent({ type: 'subscription.cancelled' })),
    ).resolves.not.toThrow();
  });
});

describe('handleWebhookEvent — payment.failed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT downgrade plan on first payment failure', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'u1', plan: 'PRO', stripeCustomerId: 'cus_test123',
    } as any);

    await handleWebhookEvent(makeEvent({ type: 'payment.failed' }));

    // Plan must remain unchanged — Stripe retries before sending subscription.cancelled
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

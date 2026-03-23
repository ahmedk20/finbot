import type { Plan } from '@prisma/client';
import { prisma }          from '../../shared/db/postgres.client';
import { logger }          from '../../shared/utils/logger';
import { getBillingProvider } from './billing.factory';
import { env }             from '../../shared/config/env';
import type { NormalizedBillingEvent } from './billing.interface';

const PLAN_RANK: Record<Plan, number> = {
  FREE: 0, STARTER: 1, PRO: 2, BUSINESS: 3,
};

// ── Checkout ──────────────────────────────────────────────────────────────────

export async function createCheckout(userId: string, plan: Exclude<Plan, 'FREE'>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const provider = getBillingProvider();

  // Get or create billing customer — provider stores the customer record
  const customerId = user.stripeCustomerId
    ?? await provider.getOrCreateCustomer(userId, user.email);

  // Persist customer ID if it's new so future checkouts skip the create step
  if (!user.stripeCustomerId) {
    await prisma.user.update({
      where: { id: userId },
      data:  { stripeCustomerId: customerId },
    });
  }

  const session = await provider.createCheckoutSession({
    userId,
    userEmail:  user.email,
    plan,
    customerId,
    successUrl: `${env.DASHBOARD_URL}/billing/success?plan=${plan}`,
    cancelUrl:  `${env.DASHBOARD_URL}/billing/cancel`,
  });

  return session;
}

// ── Portal ────────────────────────────────────────────────────────────────────

export async function createPortal(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.stripeCustomerId) {
    throw new Error('No billing account found — user has never subscribed');
  }

  const provider = getBillingProvider();
  return provider.createPortalSession({
    customerId: user.stripeCustomerId,
    returnUrl:  `${env.DASHBOARD_URL}/billing`,
  });
}

// ── Webhook handler ───────────────────────────────────────────────────────────

/**
 * Process a verified billing webhook event.
 *
 * Called from billing.controller after signature verification.
 * The event is already normalized — no provider-specific code here.
 */
export async function handleWebhookEvent(event: NormalizedBillingEvent): Promise<void> {
  const log = logger.child({ eventType: event.type, customerId: event.customerId });

  switch (event.type) {

    case 'subscription.activated': {
      // User just paid — upgrade their plan
      await upgradePlan(event.customerId, event.subscriptionId, event.plan);
      log.info({ plan: event.plan }, 'Subscription activated — plan upgraded');
      break;
    }

    case 'subscription.updated': {
      // Plan changed — could be upgrade or downgrade
      const user = await findUserByCustomerId(event.customerId);
      if (!user) { log.warn('subscription.updated: user not found'); break; }

      const currentRank = PLAN_RANK[user.plan];
      const newRank     = PLAN_RANK[event.plan];

      if (newRank !== currentRank) {
        await prisma.user.update({
          where: { id: user.id },
          data:  { plan: event.plan, stripeSubId: event.subscriptionId },
        });
        log.info({ from: user.plan, to: event.plan }, 'Plan updated');
      }
      break;
    }

    case 'subscription.cancelled': {
      // Subscription ended — downgrade to FREE at period end
      // (Stripe sends this event at end of billing period, not immediately on cancel click)
      const user = await findUserByCustomerId(event.customerId);
      if (!user) { log.warn('subscription.cancelled: user not found'); break; }

      await prisma.user.update({
        where: { id: user.id },
        data:  { plan: 'FREE', stripeSubId: null },
      });
      log.info({ previousPlan: user.plan }, 'Subscription cancelled — downgraded to FREE');
      break;
    }

    case 'payment.failed': {
      // Card declined — log for now, could email user or notify via webhook
      const user = await findUserByCustomerId(event.customerId);
      log.warn({ userId: user?.id }, 'Payment failed — user should update payment method');
      // We don't immediately downgrade — Stripe/Paddle retry for several days
      // and send subscription.cancelled only after all retries exhausted
      break;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upgradePlan(customerId: string, subscriptionId: string, plan: Plan) {
  await prisma.user.updateMany({
    where: { stripeCustomerId: customerId },
    data:  { plan, stripeSubId: subscriptionId },
  });
}

async function findUserByCustomerId(customerId: string) {
  return prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
}

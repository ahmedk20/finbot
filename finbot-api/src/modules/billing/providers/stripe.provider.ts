/**
 * Stripe billing provider implementation.
 *
 * Stripe availability: US, EU, UK, most of Asia-Pacific.
 * NOT available in: Egypt, many African countries, some MENA countries.
 * If Stripe is unavailable in your region, use paddle.provider.ts instead.
 *
 * Setup:
 *   1. Create account at stripe.com
 *   2. Create Products + Prices in Stripe dashboard (or via API)
 *   3. Copy Price IDs into .env
 *   4. Set BILLING_PROVIDER=stripe in .env
 *   5. For webhooks: stripe listen --forward-to localhost:3000/webhook/billing (dev)
 *                    add endpoint in Stripe dashboard (prod)
 */

import Stripe from 'stripe';
import type { Plan } from '@prisma/client';
import type {
  BillingProvider,
  CheckoutParams,
  CheckoutSession,
  PortalParams,
  PortalSession,
  NormalizedBillingEvent,
  BillingEventType,
} from '../billing.interface';
import { env } from '../../../shared/config/env';

// Plan → Stripe Price ID mapping
// Price IDs are created in Stripe dashboard and stored in env
const PLAN_TO_PRICE: Record<Exclude<Plan, 'FREE'>, string> = {
  STARTER:  env.BILLING_PRICE_STARTER,
  PRO:      env.BILLING_PRICE_PRO,
  BUSINESS: env.BILLING_PRICE_BUSINESS,
};

// Stripe Price ID → our Plan
// Used when parsing webhook events to know which plan was activated
function priceIdToPlan(priceId: string): Plan {
  const entry = Object.entries(PLAN_TO_PRICE).find(([, id]) => id === priceId);
  return (entry?.[0] as Plan) ?? 'FREE';
}

// Stripe subscription event → our normalized event type
const STRIPE_EVENT_MAP: Record<string, BillingEventType> = {
  'checkout.session.completed':      'subscription.activated',
  'customer.subscription.updated':   'subscription.updated',
  'customer.subscription.deleted':   'subscription.cancelled',
  'invoice.payment_failed':          'payment.failed',
};

export class StripeProvider implements BillingProvider {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.BILLING_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
    });
  }

  async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    // Search for existing customer by metadata.userId
    // This prevents creating duplicate customers if the user signs up twice
    const existing = await this.stripe.customers.search({
      query: `metadata['userId']:'${userId}'`,
      limit: 1,
    });

    if (existing.data.length > 0) {
      return existing.data[0].id;
    }

    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },   // store our userId so we can look up user on webhook
    });

    return customer.id;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession> {
    const priceId = PLAN_TO_PRICE[params.plan];

    const session = await this.stripe.checkout.sessions.create({
      mode:                'subscription',
      customer:            params.customerId,   // if set, Stripe pre-fills their info
      customer_email:      params.customerId ? undefined : params.userEmail,
      line_items:          [{ price: priceId, quantity: 1 }],
      success_url:         params.successUrl,
      cancel_url:          params.cancelUrl,
      metadata:            { userId: params.userId },
      allow_promotion_codes: true,              // let users enter discount codes
      subscription_data: {
        metadata: { userId: params.userId },    // also on the subscription object
      },
    });

    return {
      url:       session.url!,
      sessionId: session.id,
    };
  }

  async createPortalSession(params: PortalParams): Promise<PortalSession> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer:   params.customerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  }

  async verifyAndParseWebhook(rawBody: Buffer, signature: string): Promise<NormalizedBillingEvent | null> {
    // constructEvent throws if signature is invalid — never catch this silently
    // An invalid signature means the request did not come from Stripe
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.BILLING_WEBHOOK_SECRET,
      );
    } catch {
      throw new Error('Invalid Stripe webhook signature');
    }

    const normalizedType = STRIPE_EVENT_MAP[event.type];
    if (!normalizedType) {
      // Stripe sends many event types we don't handle (charge.succeeded, etc.)
      // Return null so the controller can acknowledge silently without noise
      return null;
    }

    // Extract customer + subscription IDs + plan from the event object
    // Different event types have different shapes
    let customerId:     string;
    let subscriptionId: string;
    let plan:           Plan = 'FREE';

    if (event.type === 'checkout.session.completed') {
      const session    = event.data.object as Stripe.Checkout.Session;
      customerId       = session.customer as string;
      subscriptionId   = session.subscription as string;
      // Fetch the subscription to resolve the actual price → plan
      // The checkout session itself doesn't carry the price ID directly
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      const priceId = sub.items.data[0]?.price.id;
      plan = priceId ? priceIdToPlan(priceId) : 'FREE';

    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub      = event.data.object as Stripe.Subscription;
      customerId     = sub.customer as string;
      subscriptionId = sub.id;
      const priceId  = sub.items.data[0]?.price.id;
      plan           = priceId ? priceIdToPlan(priceId) : 'FREE';

    } else if (event.type === 'invoice.payment_failed') {
      const invoice  = event.data.object as Stripe.Invoice & { subscription?: string };
      customerId     = invoice.customer as string;
      subscriptionId = invoice.subscription ?? '';
      plan           = 'FREE';

    } else {
      return null;
    }

    return {
      type: normalizedType,
      customerId,
      subscriptionId,
      plan,
      raw: event,
    };
  }
}

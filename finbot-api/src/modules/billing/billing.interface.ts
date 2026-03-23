import type { Plan } from '@prisma/client';

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface CheckoutParams {
  userId:      string;
  userEmail:   string;
  plan:        Exclude<Plan, 'FREE'>;   // can't checkout for FREE plan
  customerId?: string;                  // existing billing customer ID (if upgrading)
  successUrl:  string;                  // redirect after payment
  cancelUrl:   string;                  // redirect if user closes checkout
}

export interface PortalParams {
  customerId: string;   // billing provider's customer ID (e.g. cus_xxx or ctm_xxx)
  returnUrl:  string;   // where to send user after they leave portal
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export interface CheckoutSession {
  url:        string;   // redirect user here
  sessionId:  string;   // provider's session ID (for logging)
}

export interface PortalSession {
  url: string;          // redirect user here
}

// ── Normalized webhook event ───────────────────────────────────────────────────
//
// Every billing provider sends different event names and shapes.
// We normalize them all into these four types so the rest of the app
// never has to know which provider fired the event.
//
//   Stripe event                     → NormalizedEvent type
//   checkout.session.completed       → subscription.activated
//   customer.subscription.updated    → subscription.updated
//   customer.subscription.deleted    → subscription.cancelled
//   invoice.payment_failed           → payment.failed
//
//   Paddle event                     → NormalizedEvent type
//   subscription.created             → subscription.activated
//   subscription.updated             → subscription.updated
//   subscription.cancelled           → subscription.cancelled
//   transaction.payment_failed       → payment.failed

export type BillingEventType =
  | 'subscription.activated'   // user just paid — upgrade plan
  | 'subscription.updated'     // plan changed (upgrade or downgrade)
  | 'subscription.cancelled'   // subscription ended — downgrade to FREE
  | 'payment.failed';          // card declined — optionally notify user

export interface NormalizedBillingEvent {
  type:           BillingEventType;
  customerId:     string;        // provider's customer ID
  subscriptionId: string;        // provider's subscription ID
  plan:           Plan;          // the plan this event refers to
  raw:            unknown;       // original provider event (for logging/debugging)
}

// ── The interface every provider must implement ───────────────────────────────

export interface BillingProvider {
  /**
   * Create a hosted checkout page URL.
   * User is redirected here to enter payment details.
   * Provider handles PCI compliance — we never see card numbers.
   */
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession>;

  /**
   * Create a hosted billing portal URL.
   * User is redirected here to manage their subscription (cancel, update card, etc.)
   */
  createPortalSession(params: PortalParams): Promise<PortalSession>;

  /**
   * Verify the webhook signature and parse the event.
   *
   * rawBody: Buffer — the raw request body BEFORE any JSON parsing.
   *   This is critical: providers sign the raw bytes. If Express parses
   *   the body first, the signature check will always fail.
   *
   * signature: string — value of the provider's signature header
   *   Stripe:  req.headers['stripe-signature']
   *   Paddle:  req.headers['paddle-signature']
   *
   * Returns the normalized event or throws if signature is invalid.
   */
  verifyAndParseWebhook(rawBody: Buffer, signature: string): Promise<NormalizedBillingEvent | null>;

  /**
   * Create or retrieve a customer record at the billing provider.
   * Returns the provider's customer ID (e.g. cus_xxx or ctm_xxx).
   * Called before checkout if the user doesn't have a customerId yet.
   */
  getOrCreateCustomer(userId: string, email: string): Promise<string>;
}

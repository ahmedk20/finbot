/**
 * Paddle billing provider implementation.
 *
 * Paddle is a Merchant of Record (MoR) — they handle VAT, sales tax,
 * and compliance in 200+ countries including Egypt, MENA, Africa.
 * This makes it a strong choice for non-US/EU founders.
 *
 * Paddle vs Stripe key differences:
 *   - Paddle is the seller of record (they invoice the customer, not you)
 *   - Paddle handles all tax collection and remittance automatically
 *   - Paddle takes a higher fee (~5% vs Stripe's 2.9%) in exchange for MoR benefits
 *   - Paddle webhooks use a different signature scheme (HMAC-SHA256 with PKCS1)
 *
 * Setup (when ready):
 *   1. Create account at paddle.com (or paddle.com/billing for Paddle Billing)
 *   2. Create Products + Prices in Paddle dashboard
 *   3. Copy Price IDs into .env as BILLING_PRICE_STARTER, etc.
 *   4. Set BILLING_PROVIDER=paddle in .env
 *   5. Install SDK: npm install @paddle/paddle-node-sdk
 *
 * Docs: https://developer.paddle.com/build/subscriptions
 */

import type { Plan } from '@prisma/client';
import type {
  BillingProvider,
  CheckoutParams,
  CheckoutSession,
  PortalParams,
  PortalSession,
  NormalizedBillingEvent,
} from '../billing.interface';

export class PaddleProvider implements BillingProvider {
  constructor() {
    // TODO: initialise Paddle SDK
    // import { Paddle } from '@paddle/paddle-node-sdk';
    // this.paddle = new Paddle(env.BILLING_SECRET_KEY);
  }

  async getOrCreateCustomer(_userId: string, _email: string): Promise<string> {
    // TODO: Paddle customer creation
    // const customer = await this.paddle.customers.create({ email: _email });
    // return customer.id;  // ctm_xxxxx
    throw new Error('PaddleProvider.getOrCreateCustomer not implemented');
  }

  async createCheckoutSession(_params: CheckoutParams): Promise<CheckoutSession> {
    // TODO: Paddle checkout
    // Paddle uses client-side overlay checkout OR hosted checkout pages
    // For hosted: generate a payment link via API
    // const link = await this.paddle.pricingPreview({ ... });
    //
    // Paddle checkout URL format:
    //   https://buy.paddle.com/product/xxxxx?customer_email=user@example.com
    throw new Error('PaddleProvider.createCheckoutSession not implemented');
  }

  async createPortalSession(_params: PortalParams): Promise<PortalSession> {
    // TODO: Paddle customer portal
    // Paddle calls this the "Customer Portal" — available at:
    //   https://customer.paddle.com
    // Generate an authenticated link via:
    //   await this.paddle.customerPortalSessions.create(customerId, [...priceIds])
    throw new Error('PaddleProvider.createPortalSession not implemented');
  }

  async verifyAndParseWebhook(rawBody: Buffer, signature: string): Promise<NormalizedBillingEvent | null> {
    // TODO: Paddle webhook signature verification
    // Paddle uses a different signature scheme than Stripe:
    //   1. Get public key from Paddle dashboard
    //   2. Verify: crypto.verify('sha256', rawBody, publicKey, Buffer.from(signature, 'base64'))
    //
    // Paddle event types to handle:
    //   subscription.created   → 'subscription.activated'
    //   subscription.updated   → 'subscription.updated'
    //   subscription.cancelled → 'subscription.cancelled'
    //   transaction.payment_failed → 'payment.failed'
    //
    // Extract: event.data.customer_id, event.data.id (subscription id), event.data.items[0].price.id

    void rawBody;
    void signature;
    throw new Error('PaddleProvider.verifyAndParseWebhook not implemented');
  }
}

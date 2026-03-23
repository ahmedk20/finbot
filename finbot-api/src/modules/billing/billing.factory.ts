import type { BillingProvider } from './billing.interface';
import { env } from '../../shared/config/env';

let instance: BillingProvider | null = null;

/**
 * Returns the configured billing provider as a singleton.
 *
 * Controlled by BILLING_PROVIDER env var:
 *   BILLING_PROVIDER=stripe  → StripeProvider
 *   BILLING_PROVIDER=paddle  → PaddleProvider
 *
 * Singleton pattern: provider is created once and reused.
 * Avoids re-initialising the SDK on every request.
 */
export function getBillingProvider(): BillingProvider {
  if (instance) return instance;

  switch (env.BILLING_PROVIDER) {
    case 'stripe': {
      const { StripeProvider } = require('./providers/stripe.provider');
      instance = new StripeProvider();
      break;
    }
    case 'paddle': {
      const { PaddleProvider } = require('./providers/paddle.provider');
      instance = new PaddleProvider();
      break;
    }
    default:
      throw new Error(
        `Unknown BILLING_PROVIDER: "${env.BILLING_PROVIDER}". Must be "stripe" or "paddle".`,
      );
  }

  return instance!;
}

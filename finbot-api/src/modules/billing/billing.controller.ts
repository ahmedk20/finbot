import type { Request, Response, NextFunction } from 'express';
import { z }                    from 'zod';
import { validate }             from '../../shared/utils/validate';
import { ok }                   from '../../shared/utils/response';
import { logger }               from '../../shared/utils/logger';
import { getBillingProvider }   from './billing.factory';
import { createCheckout, createPortal, handleWebhookEvent } from './billing.service';
import { env }                  from '../../shared/config/env';

const checkoutSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'BUSINESS']),
});

export async function handleCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plan } = validate(checkoutSchema, req.body);
    const session  = await createCheckout(req.user!.userId, plan);
    res.json(ok({ checkoutUrl: session.url }));
  } catch (err) { next(err); }
}

export async function handlePortal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await createPortal(req.user!.userId);
    res.json(ok({ portalUrl: session.url }));
  } catch (err) { next(err); }
}

/**
 * Stripe/Paddle calls this endpoint when a billing event occurs.
 *
 * Security:
 *   - Raw body is required for signature verification (see app.ts mounting)
 *   - We verify the signature FIRST before processing anything
 *   - Invalid signature → 400 immediately, no further processing
 *   - We always return 200 to the provider after successful processing
 *     (if we return 4xx/5xx, the provider will retry — causing duplicate processing)
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const provider  = getBillingProvider();
  const signature = (
    req.headers['stripe-signature'] ??
    req.headers['paddle-signature'] ?? ''
  ) as string;

  let event;
  try {
    // rawBody is a Buffer because this route uses express.raw() — see app.ts
    event = await provider.verifyAndParseWebhook(req.body as Buffer, signature);
  } catch (err) {
    logger.warn({ err }, 'Billing webhook signature verification failed');
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  // null = valid signature but event type we don't handle — acknowledge silently
  if (event === null) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Log but still return 200 — we don't want the provider retrying forever
    // For critical failures, investigate via logs
    logger.error({ err, eventType: event.type }, 'Billing webhook processing error');
  }

  // Always 200 to acknowledge receipt — provider stops retrying
  res.status(200).json({ received: true });
}

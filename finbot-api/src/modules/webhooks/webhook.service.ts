import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { createWebhook, listWebhooks, deleteWebhook, findMatchingWebhooks } from './webhook.repository';
import { logger } from '../../shared/utils/logger';
import type { CreateWebhookInput } from './webhook.schema';
import type { WebhookEvent, WebhookPayload, WebhookRecord } from './webhook.types';

/**
 * Generate a webhook signing secret.
 *
 * 32 random bytes → hex string = 64 hex characters.
 * This is shown to the user ONCE at creation time and never again.
 * We store the raw secret (not hashed) because we need it for signing outgoing payloads.
 *
 * Security: the user uses this secret to verify our signature on their end.
 * Without it, an attacker could POST fake webhook payloads to their endpoint.
 * This is the same design as Stripe, GitHub, and Twilio.
 */
function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sign a webhook payload.
 *
 * HMAC-SHA256(secret, `${timestamp}.${body}`) → hex digest.
 * The timestamp is included to prevent replay attacks:
 *   - Attacker captures a valid signed payload
 *   - Re-sends it 1 hour later
 *   - Receiver checks: timestamp is old → reject
 *
 * Header sent: X-FinBot-Signature: t=<unix_ts>,v1=<hmac_hex>
 * This is the same format Stripe uses — receivers can parse it consistently.
 */
export function signPayload(secret: string, timestamp: number, body: string): string {
  const message = `${timestamp}.${body}`;
  const hmac    = crypto.createHmac('sha256', secret);
  hmac.update(message);
  return `t=${timestamp},v1=${hmac.digest('hex')}`;
}

export async function registerWebhook(input: CreateWebhookInput, userId: string) {
  const secret = generateSecret();

  const webhook = await createWebhook({
    userId,
    url:       input.url,
    asset:     input.asset ?? undefined,
    event:     input.event,
    threshold: input.threshold ?? undefined,
    secret,
  });

  // Return secret ONLY at creation time — never returned again
  return { ...webhook, secret };
}

export async function getUserWebhooks(userId: string) {
  const webhooks = await listWebhooks(userId);
  // Strip secret from list response — user should have saved it at creation
  return webhooks.map(({ secret: _s, ...rest }) => rest);
}

export async function removeWebhook(id: string, userId: string): Promise<boolean> {
  return deleteWebhook(id, userId);
}

/**
 * Fire webhooks for an event.
 *
 * This is called from:
 *  - sentiment.worker.ts after upsertScore (sentiment_change)
 *  - analysis.worker.ts after upsertAnalysisResult (analysis_done)
 *
 * Fire-and-forget: we don't wait for webhook delivery to respond to the
 * originating request.  Delivery failures are logged but not retried here.
 * For production, this should be its own BullMQ queue with retries — but
 * that's Phase 5 complexity.
 */
export async function fireWebhooks(
  asset:   string,
  event:   WebhookEvent,
  data:    Record<string, unknown>,
  previousScore?: number,  // for threshold filtering on sentiment_change
): Promise<void> {
  const hooks = await findMatchingWebhooks(asset, event);
  if (hooks.length === 0) return;

  const payload: WebhookPayload = { event, asset, data, timestamp: new Date().toISOString() };
  const body      = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  await Promise.allSettled(
    hooks
      .filter(hook => shouldFire(hook, data, previousScore))
      .map(hook => deliverWebhook(hook, body, timestamp)),
  );
}

/**
 * Threshold check for sentiment_change events.
 * If the score hasn't moved enough since the last delivery, skip.
 * Other event types always fire.
 */
function shouldFire(
  hook:  WebhookRecord,
  data:  Record<string, unknown>,
  previousScore?: number,
): boolean {
  if (hook.event !== 'sentiment_change' || hook.threshold == null) return true;
  if (previousScore == null) return true;

  const currentScore = typeof data.score === 'number' ? data.score : null;
  if (currentScore == null) return true;

  return Math.abs(currentScore - previousScore) >= hook.threshold;
}

async function deliverWebhook(hook: WebhookRecord, body: string, timestamp: number): Promise<void> {
  const signature = signPayload(hook.secret, timestamp, body);

  try {
    const res = await fetch(hook.url, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-FinBot-Signature': signature,
        'X-FinBot-Event':    hook.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),  // 10s timeout per delivery
    });

    if (!res.ok) {
      logger.warn({ webhookId: hook.id, status: res.status }, 'Webhook delivery non-2xx response');
    }
  } catch (err) {
    logger.error({ webhookId: hook.id, err }, 'Webhook delivery failed');
    // Silently swallow — fire-and-forget.  Failed webhooks visible in logs only.
    // Phase 5: move to BullMQ queue with 3 retries + exponential backoff.
  }
}

import { z } from 'zod';

export const createWebhookSchema = z.object({
  url: z
    .string()
    .url('must be a valid HTTPS URL')
    .refine(u => u.startsWith('https://'), {
      message: 'Webhook URL must use HTTPS — HTTP is not allowed (payload is signed but still sensitive)',
    }),
  asset: z
    .string()
    .max(20)
    .transform(v => v.toUpperCase().trim())
    .optional(),
  event: z.enum(['sentiment_change', 'signal_change', 'analysis_done', 'news_alert']),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('For sentiment_change: fire when |score delta| >= threshold (e.g. 0.3)'),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

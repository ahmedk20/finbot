import { z } from 'zod';

export const sentimentQuerySchema = z.object({
  window: z.enum(['24h', '7d']).default('24h'),
});

export const ingestSchema = z.object({
  articleId: z.string().min(1),
  asset:     z.string().min(1).toUpperCase(),
});

export type SentimentQuery = z.infer<typeof sentimentQuerySchema>;
export type IngestInput    = z.infer<typeof ingestSchema>;

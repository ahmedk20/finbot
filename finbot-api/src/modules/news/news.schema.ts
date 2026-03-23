import { z } from 'zod';

export const newsQuerySchema = z.object({
  asset:     z.string().toUpperCase().optional(),
  limit:     z.coerce.number().min(1).max(50).default(10),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']).optional(),
  severity:  z.enum(['critical', 'high', 'medium', 'low']).optional(),
  tier:      z.enum(['tier1', 'tier2', 'tier3', 'tier4', 'research', 'geopolitical']).optional(),
  hours:     z.coerce.number().min(1).max(168).default(24),
  query:     z.string().max(200).optional(),
});

export type NewsQueryInput = z.infer<typeof newsQuerySchema>;

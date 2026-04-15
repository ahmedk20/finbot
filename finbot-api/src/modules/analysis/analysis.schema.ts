import { z } from 'zod';

export const submitAnalysisSchema = z.object({
  asset: z
    .string()
    .min(1)
    .max(20)
    .transform(v => v.toUpperCase().trim()),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format')
    .optional()
    .default(() => new Date().toISOString().split('T')[0]),
  output_language: z.string().min(1).max(50).optional().default('Arabic'),
});

export type SubmitAnalysisInput = z.infer<typeof submitAnalysisSchema>;

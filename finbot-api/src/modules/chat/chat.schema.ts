import { z } from 'zod';

export const chatSchema = z.object({
  message: z.string().min(1).max(500),
  asset:   z.string().toUpperCase().optional(),
});

export type ChatInput = z.infer<typeof chatSchema>;

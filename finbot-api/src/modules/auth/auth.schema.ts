import { z } from 'zod';

export const registerSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string()
    .min(8,  'Password must be at least 8 characters')
    .regex(/[A-Z]/,  'Password must contain at least one uppercase letter')
    .regex(/[0-9]/,  'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export const createKeySchema = z.object({
  name: z.string().max(50).optional(),
});

// Inferred types — no need to write them manually
export type RegisterInput  = z.infer<typeof registerSchema>;
export type LoginInput     = z.infer<typeof loginSchema>;
export type CreateKeyInput = z.infer<typeof createKeySchema>;

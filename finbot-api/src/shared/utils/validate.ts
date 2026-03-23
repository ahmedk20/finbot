import type { ZodSchema } from 'zod';
import { ValidationError } from './errors';

// Reusable Zod validator — used by every controller
// Throws ValidationError (400) on failure so the global error handler catches it
// Same idea as food-delivery's validateBody() but using Zod instead of class-validator
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);
  return result.data;
}

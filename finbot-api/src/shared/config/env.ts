import { z } from 'zod';

const envSchema = z.object({
  PORT:                z.coerce.number().default(3000),
  NODE_ENV:            z.enum(['development', 'production', 'test']).default('development'),
  PINECONE_API_KEY:    z.string().min(1, 'PINECONE_API_KEY is required'),
  PINECONE_INDEX_NAME: z.string().min(1, 'PINECONE_INDEX_NAME is required'),
  HUGGINGFACE_API_KEY: z.string().min(1, 'HUGGINGFACE_API_KEY is required'),
  REDIS_URL:           z.string().url('REDIS_URL must be a valid URL'),
  DATABASE_URL:        z.string().min(1, 'DATABASE_URL is required'),
  API_KEY_SECRET:      z.string().min(32, 'API_KEY_SECRET must be at least 32 characters'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');

  parsed.error.issues.forEach(err => {
    console.error(`  ${err.path.join('.')}: ${err.message}`);
  });

  process.exit(1);
}

export const env = parsed.data;
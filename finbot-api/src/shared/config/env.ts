import { z } from 'zod';

const envSchema = z.object({
  PORT:                z.coerce.number().default(3000),
  NODE_ENV:            z.enum(['development', 'production', 'test']).default('development'),
  PINECONE_API_KEY:    z.string().min(1, 'PINECONE_API_KEY is required'),
  PINECONE_INDEX_NAME: z.string().min(1, 'PINECONE_INDEX_NAME is required'),
  HUGGINGFACE_API_KEY: z.string().min(1, 'HUGGINGFACE_API_KEY is required'),
  REDIS_URL:           z.string().url('REDIS_URL must be a valid URL'),
  DATABASE_URL:        z.string().min(1, 'DATABASE_URL is required'),
  API_KEY_SECRET:        z.string().min(32, 'API_KEY_SECRET must be at least 32 characters'),
  INTERNAL_KEY:          z.string().min(32, 'INTERNAL_KEY must be at least 32 characters'),
  JWT_ACCESS_SECRET:     z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET:    z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN:z.string().default('7d'),
  TRADING_AGENTS_URL:  z.string().url().default('http://localhost:8000'),
  FMP_API_KEY:         z.string().min(1, 'FMP_API_KEY is required'),
  MASSIVE_API_KEY:     z.string().min(1, 'MASSIVE_API_KEY is required'),
  DASHBOARD_URL:       z.string().url().default('http://localhost:3001'),

  // Billing — provider-agnostic names
  // Set BILLING_PROVIDER=stripe or BILLING_PROVIDER=paddle
  BILLING_PROVIDER:        z.enum(['stripe', 'paddle']),
  BILLING_SECRET_KEY:      z.string().min(1),   // sk_live_xxx (Stripe) or pdl_xxx (Paddle)
  BILLING_WEBHOOK_SECRET:  z.string().min(1),   // whsec_xxx (Stripe) or public key (Paddle)
  BILLING_PRICE_STARTER:   z.string().min(1),   // price_xxx (Stripe) or pri_xxx (Paddle)
  BILLING_PRICE_PRO:       z.string().min(1),
  BILLING_PRICE_BUSINESS:  z.string().min(1),

  RABBITMQ_URL: z.string().url().default('amqp://localhost:5672'),
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
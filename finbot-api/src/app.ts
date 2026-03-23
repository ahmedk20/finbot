import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { healthRouter } from './modules/health';
import { newsRouter } from './modules/news';
import { authRouter } from './modules/auth';
import { usageRouter, registerListeners } from './modules/usage';
import { sentimentRouter, sentimentInternalRouter } from './modules/sentiment';
import { streamRouter } from './modules/stream';
import { chatRouter } from './modules/chat';
import { analysisRouter } from './modules/analysis';
import { signalRouter } from './modules/signal';
import { stocksRouter } from './modules/stocks';
import { webhooksRouter } from './modules/webhooks';
import { billingRouter, handleWebhook } from './modules/billing';
import { correlationId } from './shared/middleware/correlationId.middleware';
import { trackUsage } from './shared/middleware/trackUsage.middleware';
import { requestLogger } from './shared/utils/logger';
import { errorHandler } from './shared/utils/errors';

// Start BullMQ workers — must import to register the worker processes
import './shared/queues/sentiment.worker';
import './shared/queues/analysis.worker';

// Register event bus listeners before any request can arrive
registerListeners();

const app = express();

// ── Billing webhook — MUST be before express.json() ───────────────────────────
// Signature verification requires the raw request body as a Buffer.
// express.json() converts the body to an object, destroying the raw bytes.
// express.raw() keeps it as a Buffer so the provider can verify the HMAC.
// If this is mounted after express.json(), every webhook will fail verification.
app.post('/webhook/billing', express.raw({ type: 'application/json' }), handleWebhook);

// Global middleware — runs on every request
app.use(helmet());        // security headers (X-Content-Type-Options, CSP, etc.)
app.use(express.json());
app.use(cookieParser());
app.use(correlationId);   // assigns X-Correlation-Id header for tracing
app.use(requestLogger);
app.use(trackUsage);      // fire-and-forget usage logging after response sent

// Routes
app.use('/health',           healthRouter);
app.use('/api/v1/auth',      authRouter);
app.use('/api/v1/news',      newsRouter);
app.use('/api/v1/usage',     usageRouter);
app.use('/api/v1/sentiment',   sentimentRouter);
app.use('/internal/sentiment', sentimentInternalRouter);
app.use('/api/v1/stream',      streamRouter);
app.use('/api/v1/chat',      chatRouter);
app.use('/api/v1/analysis', analysisRouter);
app.use('/api/v1/signal',   signalRouter);
app.use('/api/v1/stocks',  stocksRouter);
app.use('/api/v1/webhooks', webhooksRouter);
app.use('/api/v1/billing', billingRouter);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Global error handler — must be last
app.use(errorHandler);

export { app };

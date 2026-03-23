import { Router } from 'express';
import { authenticate, authenticateInternal } from '../../shared/middleware/auth.middleware';
import { rateLimit } from '../../shared/middleware/rateLimit.middleware';
import { getAsset, ingestArticle } from './sentiment.controller';

// Public router — mounted at /api/v1/sentiment
const router = Router();
router.get('/:asset', authenticate, rateLimit(), getAsset);

// Internal router — mounted at /internal/sentiment
// Separated so the ingest endpoint is never reachable under /api/v1/
const internalRouter = Router();
internalRouter.post('/ingest', authenticateInternal, ingestArticle);

export { router as sentimentRouter, internalRouter as sentimentInternalRouter };

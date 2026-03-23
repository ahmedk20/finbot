import { Router } from 'express';
import { authenticate }  from '../../shared/middleware/auth.middleware';
import { rateLimit }     from '../../shared/middleware/rateLimit.middleware';
import { requirePlan }   from '../../shared/middleware/tier.middleware';
import { handleSubmit, handleJobStatus, handleLatest } from './analysis.controller';

const router = Router();

// POST /analysis — queue an analysis job
// PRO plan only (expensive — 8-15 LLM calls per job)
router.post('/',              authenticate, requirePlan('PRO'), rateLimit(), handleSubmit);

// GET /analysis/job/:jobId — poll job status
router.get('/job/:jobId',    authenticate, requirePlan('PRO'), handleJobStatus);

// GET /analysis/latest/:asset — most recent completed result for an asset
router.get('/latest/:asset', authenticate, requirePlan('PRO'), handleLatest);

export { router as analysisRouter };

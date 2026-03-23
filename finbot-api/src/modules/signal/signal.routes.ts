import { Router }     from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { rateLimit }    from '../../shared/middleware/rateLimit.middleware';
import { requirePlan }  from '../../shared/middleware/tier.middleware';
import { handleSignal } from './signal.controller';

const router = Router();

// GET /signal/:asset — fast signal (no LLM calls, ~500ms)
// PRO plan only — requires sentiment data from BullMQ worker
router.get('/:asset', authenticate, requirePlan('PRO'), rateLimit(), handleSignal);

export { router as signalRouter };

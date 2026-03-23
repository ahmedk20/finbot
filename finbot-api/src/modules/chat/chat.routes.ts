import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { rateLimit } from '../../shared/middleware/rateLimit.middleware';
import { requirePlan } from '../../shared/middleware/tier.middleware';
import { handleChat } from './chat.controller';

const router = Router();

// PRO plan only — each call costs one LLM API call
// authenticate → verify API key
// requirePlan  → block FREE/STARTER with 403
// rateLimit    → enforce per-minute sliding window
router.post('/', authenticate, requirePlan('PRO'), rateLimit(), handleChat);

export { router as chatRouter };

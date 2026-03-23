import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { getUsage } from './usage.controller';

const router = Router();

router.get('/', authenticate, getUsage);

export { router as usageRouter };

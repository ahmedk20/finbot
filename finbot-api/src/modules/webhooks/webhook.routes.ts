import { Router }     from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requirePlan }  from '../../shared/middleware/tier.middleware';
import { handleCreate, handleList, handleDelete } from './webhook.controller';

const router = Router();

// BUSINESS plan only — webhooks are for high-volume automated consumers
router.post(  '/',    authenticate, requirePlan('BUSINESS'), handleCreate);
router.get(   '/',    authenticate, requirePlan('BUSINESS'), handleList);
router.delete('/:id', authenticate, requirePlan('BUSINESS'), handleDelete);

export { router as webhooksRouter };

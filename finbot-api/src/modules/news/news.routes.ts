import { Router } from 'express';
import { listNews, breakingNews, getById, getContext } from './news.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { rateLimit } from '../../shared/middleware/rateLimit.middleware';

const router = Router();

// All news routes require authentication + rate limiting
router.use(authenticate);
router.use(rateLimit());

// Order matters — /breaking must be before /:id
router.get('/breaking',     breakingNews);
router.get('/',             listNews);
router.get('/:id/context',  getContext);  // must be before /:id
router.get('/:id',          getById);

export { router as newsRouter };

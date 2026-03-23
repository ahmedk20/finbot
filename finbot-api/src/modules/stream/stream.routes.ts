import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { generateToken, streamSentiment, streamNews } from './stream.controller';

const router = Router();

// Step 1: client calls this with their API key to get a short-lived stream token
// POST /stream/token  →  { token, expiresIn: 60 }
router.post('/token', authenticate, generateToken);

// Step 2: client connects with EventSource using the token
// GET /stream/sentiment/:asset?token=xxx
// GET /stream/news/:asset?token=xxx
// No authenticate middleware here — token IS the auth
router.get('/sentiment/:asset', streamSentiment);
router.get('/news/:asset',      streamNews);

export { router as streamRouter };

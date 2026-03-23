import { Router }      from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { handleCheckout, handlePortal } from './billing.controller';

const router = Router();

// POST /billing/checkout — get a checkout URL for a plan upgrade
router.post('/checkout', authenticate, handleCheckout);

// POST /billing/portal — get a billing management URL (cancel, update card)
router.post('/portal',   authenticate, handlePortal);

// NOTE: /webhook/billing is NOT here.
// It is mounted directly in app.ts with express.raw() body parser
// BEFORE the global express.json() middleware.
// This is required for webhook signature verification to work.

export { router as billingRouter };

import { Router } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';

const router = Router();

// ── Account (shared by both traders and developers) ───────────────────────────
router.post('/register', authController.register);

// ── Dashboard auth (traders — JWT via httpOnly cookies) ───────────────────────
router.post('/dashboard/login',   authController.dashboardLogin);
router.post('/dashboard/refresh', authController.dashboardRefresh);
router.post('/dashboard/logout',  authController.dashboardLogout);

// ── Developer auth (API clients — API key in Authorization header) ────────────
router.post('/login',        authController.login);          // returns user info
router.get('/keys',          authenticate, authController.listApiKeys);
router.post('/keys',         authenticate, authController.createApiKey);
router.delete('/keys/:id',   authenticate, authController.revokeApiKey);

export { router as authRouter };

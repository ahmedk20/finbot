import { Router } from 'express';
import { authenticate }  from '../../shared/middleware/auth.middleware';
import { rateLimit }     from '../../shared/middleware/rateLimit.middleware';
import { requirePlan }   from '../../shared/middleware/tier.middleware';
import {
  handleGetProfile,
  handleGetFullProfile,
  handleGetFinancials,
  handleGetAnalysts,
  handleGetOwnership,
  handleGetChart,
} from './stock.controller';

const router = Router();

// All stock endpoints require at least STARTER plan.
// Basic profile is cheap; full profile and financials require STARTER+.
// Charts and ownership are PRO (heavier Polygon calls).

// GET /stocks/:ticker — company profile + live price snapshot
router.get('/:ticker',            authenticate, requirePlan('STARTER'), rateLimit(), handleGetProfile);

// GET /stocks/:ticker/full?range=1M — all sections in one call
router.get('/:ticker/full',       authenticate, requirePlan('STARTER'), rateLimit(), handleGetFullProfile);

// GET /stocks/:ticker/financials?period=quarter — income/balance/cashflow
router.get('/:ticker/financials', authenticate, requirePlan('STARTER'), rateLimit(), handleGetFinancials);

// GET /stocks/:ticker/analysts — grades + price targets
router.get('/:ticker/analysts',   authenticate, requirePlan('STARTER'), rateLimit(), handleGetAnalysts);

// GET /stocks/:ticker/ownership — institutional + ETF holders
router.get('/:ticker/ownership',  authenticate, requirePlan('PRO'),     rateLimit(), handleGetOwnership);

// GET /stocks/:ticker/chart?range=1M — OHLCV candles
router.get('/:ticker/chart',      authenticate, requirePlan('PRO'),     rateLimit(), handleGetChart);

export { router as stocksRouter };

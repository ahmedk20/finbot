import type { Request, Response, NextFunction } from 'express';
import { TierError } from '../utils/errors';

type Plan = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';

// Ordered lowest → highest so numeric comparison works
const PLAN_RANK: Record<Plan, number> = {
  FREE:     0,
  STARTER:  1,
  PRO:      2,
  BUSINESS: 3,
};

// requirePlan('PRO') → middleware that blocks anyone below PRO
// Usage: router.get('/analysis', authenticate, requirePlan('PRO'), handler)
export function requirePlan(minimum: Plan) {
  return function tierMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const userPlan = (req.user?.plan ?? 'FREE') as Plan;
    const userRank = PLAN_RANK[userPlan] ?? 0;
    const minRank  = PLAN_RANK[minimum];

    if (userRank < minRank) {
      next(new TierError(`This feature`)); return;
    }

    next();
  };
}

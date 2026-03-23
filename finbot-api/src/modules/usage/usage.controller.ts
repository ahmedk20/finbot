import type { Request, Response, NextFunction } from 'express';
import { getSummary } from './usage.service';
import { ok } from '../../shared/utils/response';

export async function getUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // req.user is guaranteed by authenticate middleware on this route
    const summary = await getSummary(req.user!.userId, req.user!.plan);
    res.json(ok(summary));
  } catch (err) { next(err); }
}

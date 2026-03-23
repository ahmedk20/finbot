import type { Request, Response, NextFunction } from 'express';
import { ok }             from '../../shared/utils/response';
import { computeSignal }  from './signal.service';

export async function handleSignal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await computeSignal(req.params['asset'] as string);
    res.json(ok(result));
  } catch (err) { next(err); }
}

import type { Request, Response, NextFunction } from 'express';
import { validate }                   from '../../shared/utils/validate';
import { ok }                         from '../../shared/utils/response';
import { submitAnalysisSchema }       from './analysis.schema';
import { submitAnalysis, getJobStatus, getLatestAnalysis } from './analysis.service';

export async function handleSubmit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(submitAnalysisSchema, req.body);
    const result = await submitAnalysis(input, req.user!.userId);
    // 202 Accepted — job has been queued, not yet complete
    res.status(202).json(ok(result));
  } catch (err) { next(err); }
}

export async function handleJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getJobStatus(req.params['jobId'] as string);
    res.json(ok(result));
  } catch (err) { next(err); }
}

export async function handleLatest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getLatestAnalysis(req.params['asset'] as string);
    if (!result) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No analysis found for this asset' } });
      return;
    }
    res.json(ok(result));
  } catch (err) { next(err); }
}

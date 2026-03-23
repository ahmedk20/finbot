import type { Request, Response, NextFunction } from 'express';
import { validate }             from '../../shared/utils/validate';
import { ok }                   from '../../shared/utils/response';
import { createWebhookSchema }  from './webhook.schema';
import { registerWebhook, getUserWebhooks, removeWebhook } from './webhook.service';

export async function handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(createWebhookSchema, req.body);
    const result = await registerWebhook(input, req.user!.userId);
    // 201 Created — secret shown here only, never again
    res.status(201).json(ok(result));
  } catch (err) { next(err); }
}

export async function handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getUserWebhooks(req.user!.userId);
    res.json(ok(result));
  } catch (err) { next(err); }
}

export async function handleDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deleted = await removeWebhook(req.params['id'] as string, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
      return;
    }
    res.json(ok({ deleted: true }));
  } catch (err) { next(err); }
}

import type { Request, Response, NextFunction } from 'express';
import { validate } from '../../shared/utils/validate';
import { ok } from '../../shared/utils/response';
import { chatSchema } from './chat.schema';
import { chat } from './chat.service';

export async function handleChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input  = validate(chatSchema, req.body);
    const result = await chat(input);
    res.json(ok(result));
  } catch (err) { next(err); }
}

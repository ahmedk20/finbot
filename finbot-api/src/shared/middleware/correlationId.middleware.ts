import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Assigns a unique ID to every request
// Logged with every request — lets you trace a single request through all logs
// Adopted from food-delivery-core-service pattern
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

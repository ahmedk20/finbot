import type { Request, Response } from 'express';
import { prisma } from '../../shared/db/postgres.client';
import { ok } from '../../shared/utils/response';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const start = Date.now();

  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }

  res.json(
    ok(
      { status: dbStatus === 'ok' ? 'ok' : 'degraded', services: { api: 'ok', db: dbStatus } },
      { latency_ms: Date.now() - start },
    ),
  );
}

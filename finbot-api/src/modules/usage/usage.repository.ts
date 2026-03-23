import { prisma } from '../../shared/db/postgres.client';
import type { LogUsageInput } from './usage.types';
import type { Plan } from '@prisma/client';

export async function logRequest(input: LogUsageInput): Promise<void> {
  await prisma.usageLog.create({
    data: {
      userId:     input.userId,
      endpoint:   input.endpoint,
      plan:       input.plan as Plan,
      statusCode: input.statusCode,
      latency_ms: input.latency_ms,
    },
  });
}

// Count requests for a user within a date range
export async function countRequests(userId: string, from: Date, to: Date): Promise<number> {
  return prisma.usageLog.count({
    where: {
      userId,
      createdAt: { gte: from, lte: to },
    },
  });
}

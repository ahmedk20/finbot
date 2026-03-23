import { prisma } from '../../shared/db/postgres.client';
import { prismaRead } from '../../shared/db/postgres.read';
import type { LLMSentimentResult } from './sentiment.types';

// Upsert — not create. If the BullMQ worker retries a job that already succeeded
// (e.g. the job completed but Redis didn't acknowledge it), we update instead of
// creating a duplicate. articleId is @unique so this is safe.
export async function upsertScore(
  articleId: string,
  asset:     string,
  result:    LLMSentimentResult,
): Promise<void> {
  await prisma.sentimentScore.upsert({
    where:  { articleId },
    update: { score: result.score, label: result.label, model: result.model_used },
    create: { articleId, asset, score: result.score, label: result.label, model: result.model_used },
  });
}

// Read recent scores for an asset — goes to read replica
// windowHours: 24 = last 24h, 168 = last 7 days
export async function findByAsset(
  asset:       string,
  windowHours: number,
): Promise<Array<{ score: number; label: string; createdAt: Date }>> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  return prismaRead.sentimentScore.findMany({
    where:   { asset, createdAt: { gte: since } },
    select:  { score: true, label: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

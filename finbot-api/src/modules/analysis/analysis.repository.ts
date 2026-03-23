import { prisma }     from '../../shared/db/postgres.client';
import { prismaRead } from '../../shared/db/postgres.read';
import type { AnalysisReports, AnalysisResultRecord } from './analysis.types';

interface UpsertInput {
  jobId:     string;
  asset:     string;
  assetType: string;
  date:      string;
  decision:  string;
  reasoning: string;
  reports:   AnalysisReports;
}

export async function upsertAnalysisResult(data: UpsertInput): Promise<void> {
  await prisma.analysisResult.upsert({
    where:  { jobId: data.jobId },
    update: {
      decision:  data.decision,
      reasoning: data.reasoning,
      reports:   data.reports as object,
    },
    create: {
      jobId:     data.jobId,
      asset:     data.asset,
      assetType: data.assetType,
      date:      data.date,
      decision:  data.decision,
      reasoning: data.reasoning,
      reports:   data.reports as object,
    },
  });
}

export async function findResultByJobId(jobId: string): Promise<AnalysisResultRecord | null> {
  return prismaRead.analysisResult.findUnique({ where: { jobId } }) as Promise<AnalysisResultRecord | null>;
}

export async function findLatestForAsset(asset: string): Promise<AnalysisResultRecord | null> {
  return prismaRead.analysisResult.findFirst({
    where:   { asset },
    orderBy: { createdAt: 'desc' },
  }) as Promise<AnalysisResultRecord | null>;
}

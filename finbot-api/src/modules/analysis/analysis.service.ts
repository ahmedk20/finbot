import { analysisQueue }        from '../../shared/queues/analysis.queue';
import { findResultByJobId, findLatestForAsset } from './analysis.repository';
import * as l2 from '../../shared/cache/l2.cache';
import type { SubmitAnalysisInput }  from './analysis.schema';
import type { JobStatusResponse, AnalysisResultRecord } from './analysis.types';

// Analysis results are immutable once written — cache aggressively.
// 1h TTL because "latest" may change if a new job completes for the same asset.
const LATEST_TTL_SEC = 3600;

/**
 * Submit an analysis job for an asset.
 *
 * Deduplication: BullMQ jobId = `analysis:${asset}:${date}`.
 * If the same asset+date combination is requested twice, BullMQ silently
 * discards the second job — the caller gets the same jobId back and can
 * poll for the result from the first run.
 */
export async function submitAnalysis(
  input:  SubmitAnalysisInput,
  userId: string,
): Promise<{ jobId: string }> {
  const jobId = `analysis:${input.asset}:${input.date}`;

  // If the previous job with this ID failed, remove it before re-adding.
  // BullMQ deduplication works by jobId — a failed job stays in the queue
  // under the same ID and silently blocks new submissions for the same asset+date.
  const existing = await analysisQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed') await existing.remove();
  }

  await analysisQueue.add(
    'run-analysis',
    { asset: input.asset, date: input.date, userId, output_language: input.output_language },
    { jobId },  // explicit jobId enables deduplication for non-failed jobs
  );

  return { jobId };
}

/**
 * Poll the status of an analysis job by jobId.
 *
 * BullMQ states:
 *   waiting   — queued, not picked up yet
 *   active    — worker is running it now (could take 15-120s)
 *   completed — done, result in Postgres
 *   failed    — all retries exhausted
 *
 * We read job state from BullMQ (Redis) and result from Postgres.
 * The two sources are consistent: worker only marks 'completed' after
 * successfully writing to Postgres.
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const job = await analysisQueue.getJob(jobId);

  if (!job) {
    return { jobId, status: 'unknown' };
  }

  const state = await job.getState(); // 'waiting' | 'active' | 'completed' | 'failed' | ...

  if (state === 'completed') {
    const result = await findResultByJobId(jobId);
    return { jobId, status: 'completed', result: result ?? undefined };
  }

  if (state === 'failed') {
    return {
      jobId,
      status: 'failed',
      error:  job.failedReason ?? 'Analysis failed — check logs',
    };
  }

  // 'waiting', 'active', 'delayed', etc. — normalise to waiting/active
  return {
    jobId,
    status: state === 'active' ? 'active' : 'waiting',
  };
}

/**
 * Return the most recent completed analysis for an asset.
 * Used by users who want "current" analysis without tracking a jobId.
 * Cached in Redis for 1h — invalidated when a new result is written for the same asset.
 */
export async function getLatestAnalysis(asset: string): Promise<AnalysisResultRecord | null> {
  const key    = `analysis:latest:${asset.toUpperCase()}`;
  const cached = await l2.get<AnalysisResultRecord>(key);
  if (cached) return cached;

  const result = await findLatestForAsset(asset.toUpperCase());
  if (result) await l2.set(key, result, LATEST_TTL_SEC);
  return result;
}

// Called by the analysis worker after writing a new result — next read gets fresh data.
export async function invalidateLatestCache(asset: string): Promise<void> {
  await l2.del(`analysis:latest:${asset.toUpperCase()}`);
}

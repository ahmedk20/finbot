import { Worker }     from 'bullmq';
import { env }        from '../config/env';
import { logger }     from '../utils/logger';
import { analyze, getAssetType } from '../llm/llm.client';
import { upsertAnalysisResult }  from '../../modules/analysis/analysis.repository';
import { invalidateLatestCache }  from '../../modules/analysis/analysis.service';
import { fireWebhooks }          from '../../modules/webhooks';
import type { AnalysisJobData }  from '../../modules/analysis/analysis.types';

const connection = {
  host:     new URL(env.REDIS_URL).hostname,
  port:     Number(new URL(env.REDIS_URL).port) || 6379,
  password: new URL(env.REDIS_URL).password || undefined,
};

/**
 * Map asset type → analyst list for TradingAgents.
 *
 * Why skip 'fundamentals' for crypto?
 * P/E ratio, EPS, revenue, balance sheet — none of these exist for BTC or ETH.
 * Sending a crypto ticker to the Fundamentals Analyst produces hallucinated or
 * empty data from yfinance, which then poisons the investment debate.
 * Better to run 3 solid analysts than 4 where one is noise.
 *
 * For stocks: all 4 analysts run. Fundamentals are meaningful and yfinance
 * returns real P/E, EPS, income statement, etc.
 */
function resolveAnalysts(assetType: string): string[] {
  return assetType === 'crypto'
    ? ['market', 'social', 'news']              // skip fundamentals for crypto
    : ['market', 'social', 'news', 'fundamentals'];
}

/**
 * TradingAgents expects standard stock tickers (NVDA) or Yahoo Finance
 * crypto tickers (BTC-USD). Our internal symbols are bare (BTC, ETH).
 * Append -USD for crypto so yfinance resolves the correct instrument.
 */
function resolveTicker(asset: string, assetType: string): string {
  return assetType === 'crypto' ? `${asset}-USD` : asset;
}

const worker = new Worker<AnalysisJobData>(
  'analysis',
  async (job) => {
    const { asset, date } = job.data;
    const log = logger.child({ jobId: job.id, asset, date });

    log.info('Analysis job started');

    // 1. Classify asset — determines analyst selection and ticker format
    const { asset_type: assetType } = await getAssetType(asset);
    log.info({ assetType }, 'Asset classified');

    // 2. Resolve TradingAgents inputs
    const analysts = resolveAnalysts(assetType);
    const ticker   = resolveTicker(asset, assetType);

    // 3. Run TradingAgents — this takes 15-120s, all in trading-agents service
    const result = await analyze({ ticker, date, analysts });
    log.info({ decision: result.decision }, 'TradingAgents analysis complete');

    // 4. Persist result — upsert so retries don't create duplicates
    await upsertAnalysisResult({
      jobId:     String(job.id),
      asset,
      assetType,
      date,
      decision:  result.decision,
      reasoning: result.final_trade_decision ?? '',
      reports: {
        market:          result.market_report         ?? null,
        sentiment:       result.sentiment_report      ?? null,
        news:            result.news_report           ?? null,
        fundamentals:    result.fundamentals_report   ?? null,
        investment_plan: result.investment_plan       ?? null,
      },
    });

    log.info('Analysis result persisted');

    // Invalidate latest cache so next read returns this new result
    await invalidateLatestCache(asset);

    // Fire webhooks — fire-and-forget, never fail the job over a delivery error
    try {
      await fireWebhooks(asset, 'analysis_done', {
        jobId:    String(job.id),
        decision: result.decision,
        date,
        assetType,
      });
    } catch (err) {
      log.warn({ err }, 'Failed to fire analysis_done webhooks');
    }
  },
  {
    connection,
    concurrency: 1,  // TradingAgents is CPU + LLM heavy — one at a time
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Analysis job failed');
});

worker.on('error', (err) => {
  logger.error(err, 'Analysis worker error');
});

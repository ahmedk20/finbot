import type { Request, Response, NextFunction } from 'express';
import { validate } from '../../shared/utils/validate';
import { ok } from '../../shared/utils/response';
import { sentimentQuerySchema, ingestSchema } from './sentiment.schema';
import { getAssetSentiment, enqueueAnalysis } from './sentiment.service';

// GET /api/v1/sentiment/:asset?window=24h
export async function getAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const asset  = String(req.params.asset).toUpperCase();
    const params = validate(sentimentQuerySchema, req.query);
    const result = await getAssetSentiment(asset, params);
    res.json(ok(result));
  } catch (err) { next(err); }
}

// POST /internal/sentiment/ingest
// Called by news-scraper after upserting an article to Pinecone.
// Auth enforced by authenticateInternal middleware on the route.
export async function ingestArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = validate(ingestSchema, req.body);
    await enqueueAnalysis({ articleId: input.articleId, asset: input.asset });
    res.status(202).json(ok({ queued: true }));
  } catch (err) { next(err); }
}

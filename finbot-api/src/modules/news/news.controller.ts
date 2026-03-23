import type { Request, Response, NextFunction } from 'express';
import { newsQuerySchema } from './news.schema';
import { getNews, getBreakingNews, getArticleById, getArticleContext } from './news.service';
import { ArticleNotFound } from './news.errors';
import { ok } from '../../shared/utils/response';
import { validate } from '../../shared/utils/validate';

export async function listNews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = validate(newsQuerySchema, req.query);

    // TODO Day 24-25: read plan from req.user.plan — withSummary = plan !== 'FREE'
    const result = await getNews(params, true);

    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
    res.json(ok(
      { articles: result.articles, summary: result.summary, total: result.total },
      { cached: result.cached, latency_ms: result.latency_ms },
    ));
  } catch (err) { next(err); }
}

export async function breakingNews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit } = validate(
      newsQuerySchema.pick({ limit: true }),
      req.query,
    );
    const result = await getBreakingNews(limit);

    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
    res.json(ok(
      { articles: result.articles, total: result.total },
      { cached: result.cached, latency_ms: result.latency_ms },
    ));
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const article = await getArticleById(String(req.params.id));
    if (!article) throw ArticleNotFound();
    res.json(ok(article));
  } catch (err) { next(err); }
}

export async function getContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const context = await getArticleContext(String(req.params.id));
    if (!context) throw ArticleNotFound();
    res.json(ok(context));
  } catch (err) { next(err); }
}

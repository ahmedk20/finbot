import type { Request, Response, NextFunction } from 'express';
import * as service from './stock.service';

// GET /stocks/:ticker
export async function handleGetProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const data   = await service.getProfile(ticker);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /stocks/:ticker/full?range=1M
export async function handleGetFullProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const range  = (req.query['range'] as string) || '1M';
    const data   = await service.getFullProfile(ticker, range);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /stocks/:ticker/financials?period=quarter
export async function handleGetFinancials(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const period = ((req.query['period'] as string) || 'quarter') as 'quarter' | 'annual';
    const data   = await service.getFinancials(ticker, period);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /stocks/:ticker/analysts
export async function handleGetAnalysts(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const data   = await service.getAnalysts(ticker);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /stocks/:ticker/ownership
export async function handleGetOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const data   = await service.getOwnership(ticker);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /stocks/:ticker/chart?range=1M
export async function handleGetChart(req: Request, res: Response, next: NextFunction) {
  try {
    const ticker = (req.params['ticker'] as string).toUpperCase();
    const range  = (req.query['range'] as string) || '1M';
    const data   = await service.getChart(ticker, range);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

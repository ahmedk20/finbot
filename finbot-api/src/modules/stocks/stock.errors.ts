import { AppError } from '../../shared/utils/errors';

export class StockNotFoundError extends AppError {
  constructor(ticker: string) {
    super(404, `No data found for ticker: ${ticker}`, 'STOCK_NOT_FOUND');
  }
}

export class StockDataUnavailableError extends AppError {
  constructor(ticker: string, source: string) {
    super(503, `${source} data unavailable for ${ticker}`, 'STOCK_DATA_UNAVAILABLE');
  }
}

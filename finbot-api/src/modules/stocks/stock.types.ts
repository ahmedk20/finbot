// ── DB record shapes (match Prisma models) ────────────────────────────────────

export interface StockProfileRecord {
  id:          string;
  ticker:      string;
  name?:       string | null;
  exchange?:   string | null;
  sector?:     string | null;
  industry?:   string | null;
  description?: string | null;
  ceo?:        string | null;
  employees?:  number | null;
  website?:    string | null;
  country?:    string | null;
  ipoDate?:    string | null;
  currency?:   string | null;
  isEtf?:      boolean | null;
  price?:      number | null;
  change?:     number | null;
  changePct?:  number | null;
  marketCap?:  number | null;
  pe?:         number | null;
  eps?:        number | null;
  beta?:       number | null;
  weekHigh52?: number | null;
  weekLow52?:  number | null;
  avgVolume?:  number | null;
  dcfValue?:   number | null;
  aiSummary?:  string | null;
  aiSummaryAt?: Date | null;
  updatedAt:   Date;
  createdAt:   Date;
}

// ── API response shapes (returned to the client) ──────────────────────────────

export interface StockProfileResponse {
  ticker:      string;
  name?:       string | null;
  exchange?:   string | null;
  sector?:     string | null;
  industry?:   string | null;
  description?: string | null;
  ceo?:        string | null;
  employees?:  number | null;
  website?:    string | null;
  country?:    string | null;
  ipoDate?:    string | null;
  currency?:   string | null;
  isEtf?:      boolean | null;
  // Live price data
  price?:      number | null;
  change?:     number | null;
  changePct?:  number | null;
  marketCap?:  number | null;
  pe?:         number | null;
  eps?:        number | null;
  beta?:       number | null;
  weekHigh52?: number | null;
  weekLow52?:  number | null;
  avgVolume?:  number | null;
  dcfValue?:   number | null;
  aiSummary?:  string | null;
  // Meta
  cachedAt:    Date;
}

export interface FullStockProfileResponse {
  profile:     StockProfileResponse;
  financials?: unknown;         // FMP financials (income, balance, cashflow)
  analysts?:   unknown;         // grades + price target consensus
  ownership?:  unknown;         // institutional + ETF holders
  earnings?:   unknown;         // next date + surprise history
  chart?:      unknown;         // OHLCV candles
}

from pydantic import BaseModel
from typing import Optional, Any, Literal


# ── LLM gateway ──────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str   # "system" | "user" | "assistant"
    content: str


class CompleteRequest(BaseModel):
    messages: list[Message]
    temperature: float = 0.2
    max_tokens: int = 1024
    model: Optional[str] = None   # pin to specific model, skips fallback chain


class CompleteResponse(BaseModel):
    content: str
    model_used: str
    input_tokens: int
    output_tokens: int


# ── Technical indicators ──────────────────────────────────────────────────────

class IndicatorsRequest(BaseModel):
    asset: str                               # BTC, ETH, NVDA, etc.
    period: str = "3mo"                      # 1mo | 3mo | 6mo | 1y | 2y
    indicators: Optional[list[str]] = None   # None = all


class IndicatorsResponse(BaseModel):
    asset: str
    ticker: str
    period: str
    candles: int
    rsi: Optional[float] = None
    macd: Optional[dict[str, float]] = None
    bb: Optional[dict[str, float]] = None
    ema: Optional[dict[str, float]] = None
    atr: Optional[float] = None
    vwap: Optional[float] = None


# ── TradingAgents analysis ────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    ticker: str                          # e.g. "NVDA", "BTC-USD"
    date: str                            # YYYY-MM-DD — trade date for context
    analysts: list[str] = [
        "market", "social", "news", "fundamentals"
    ]


class AnalyzeResponse(BaseModel):
    ticker: str
    date: str
    decision: str                        # "BUY" | "SELL" | "HOLD"
    market_report: Optional[str] = None
    sentiment_report: Optional[str] = None
    news_report: Optional[str] = None
    fundamentals_report: Optional[str] = None
    investment_plan: Optional[str] = None
    final_trade_decision: Optional[str] = None
    raw_state: Optional[dict[str, Any]] = None


# ── Price history ─────────────────────────────────────────────────────────────

class PriceHistoryRequest(BaseModel):
    asset:      str   # BTC, ETH, NVDA, AAPL...
    event_date: str   # YYYY-MM-DD — the date the historical news event occurred


class PriceHistoryResponse(BaseModel):
    asset:           str
    ticker:          str
    event_date:      str
    price_at_event:  Optional[float] = None
    price_1d_after:  Optional[float] = None
    price_7d_after:  Optional[float] = None
    price_30d_after: Optional[float] = None
    change_1d_pct:   Optional[float] = None
    change_7d_pct:   Optional[float] = None
    change_30d_pct:  Optional[float] = None


# ── Data endpoints ────────────────────────────────────────────────────────────

class AssetTypeRequest(BaseModel):
    asset: str


class AssetTypeResponse(BaseModel):
    asset:      str
    asset_type: Literal["crypto", "stock", "unknown"]


class FundamentalsRequest(BaseModel):
    ticker: str   # stock ticker: NVDA, AAPL, etc.


class FundamentalsResponse(BaseModel):
    ticker:              str
    name:                Optional[str]  = None
    sector:              Optional[str]  = None
    industry:            Optional[str]  = None
    market_cap:          Optional[int]  = None
    enterprise_value:    Optional[int]  = None
    pe_ratio:            Optional[float] = None
    forward_pe:          Optional[float] = None
    peg_ratio:           Optional[float] = None
    price_to_book:       Optional[float] = None
    price_to_sales:      Optional[float] = None
    ev_to_ebitda:        Optional[float] = None
    eps_ttm:             Optional[float] = None
    eps_forward:         Optional[float] = None
    profit_margin:       Optional[float] = None
    operating_margin:    Optional[float] = None
    roe:                 Optional[float] = None
    roa:                 Optional[float] = None
    revenue_growth:      Optional[float] = None
    earnings_growth:     Optional[float] = None
    revenue_ttm:         Optional[int]   = None
    total_cash:          Optional[int]   = None
    total_debt:          Optional[int]   = None
    debt_to_equity:      Optional[float] = None
    current_ratio:       Optional[float] = None
    quick_ratio:         Optional[float] = None
    dividend_yield:      Optional[float] = None
    payout_ratio:        Optional[float] = None
    shares_outstanding:  Optional[int]   = None
    short_ratio:         Optional[float] = None
    short_percent_float: Optional[float] = None
    fifty_two_week_high: Optional[float] = None
    fifty_two_week_low:  Optional[float] = None
    beta:                Optional[float] = None


class OnchainRequest(BaseModel):
    asset: str   # crypto ticker: BTC, ETH, etc.


class OnchainResponse(BaseModel):
    asset:                    str
    coin_id:                  str
    name:                     Optional[str]   = None
    price_usd:                Optional[float] = None
    price_change_24h_pct:     Optional[float] = None
    price_change_7d_pct:      Optional[float] = None
    ath_usd:                  Optional[float] = None
    ath_change_pct:           Optional[float] = None
    market_cap_usd:           Optional[float] = None
    market_cap_rank:          Optional[int]   = None
    fully_diluted_valuation:  Optional[float] = None
    total_volume_24h_usd:     Optional[float] = None
    circulating_supply:       Optional[float] = None
    total_supply:             Optional[float] = None
    max_supply:               Optional[float] = None
    twitter_followers:        Optional[int]   = None
    reddit_subscribers:       Optional[int]   = None
    reddit_active_accounts:   Optional[int]   = None
    sentiment_votes_up_pct:   Optional[float] = None
    sentiment_votes_down_pct: Optional[float] = None


class InsidersRequest(BaseModel):
    ticker:      str
    last_n_days: int = 90


class InsiderTransaction(BaseModel):
    insider:     Optional[str]   = None
    position:    Optional[str]   = None
    transaction: Optional[str]   = None
    shares:      int             = 0
    value_usd:   Optional[float] = None
    date:        Optional[str]   = None
    is_buy:      bool            = False


class InsidersResponse(BaseModel):
    ticker:          str
    period_days:     int
    buy_count:       int
    sell_count:      int
    buy_shares:      int            = 0
    sell_shares:     int            = 0
    net_shares:      int
    total_value_usd: Optional[float] = None
    transactions:    list[InsiderTransaction] = []


# ── FRED economic indicators ──────────────────────────────────────────────────

class EconomicResponse(BaseModel):
    fed_rate:        Optional[float] = None
    cpi_yoy:         Optional[float] = None
    unemployment:    Optional[float] = None
    gdp_growth:      Optional[float] = None
    composite_score: Optional[float] = None
    degraded:        bool
    available_count: int

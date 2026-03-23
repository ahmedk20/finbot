"""
Stock fundamentals via yfinance.

Returns valuation, profitability, and balance-sheet metrics for a given stock ticker.
Only makes sense for stocks — call get_asset_type() before calling fetch().

yfinance pulls this from Yahoo Finance's undocumented API (same data Yahoo's site shows).
No API key required but has rate limits (~2000 req/hour per IP at generous estimate).
"""

import yfinance as yf
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def fetch(ticker: str) -> dict:
    """
    Fetch fundamental data for a stock ticker.

    Args:
        ticker: Stock ticker (e.g. 'NVDA', 'AAPL')

    Returns:
        dict with valuation, growth, and balance sheet fields.
        Fields that yfinance cannot provide are None.

    Raises:
        ValueError: if the ticker returns no data at all (bad symbol or delisted).
    """
    stock = yf.Ticker(ticker.upper())

    try:
        info = stock.info
    except Exception as e:
        raise ValueError(f"yfinance failed to fetch info for {ticker}: {e}") from e

    if not info or info.get("quoteType") is None:
        raise ValueError(f"No data returned for ticker {ticker} — may be invalid or delisted")

    def safe(key: str) -> Optional[float]:
        val = info.get(key)
        if val is None:
            return None
        try:
            return round(float(val), 4)
        except (TypeError, ValueError):
            return None

    return {
        "ticker":          ticker.upper(),
        "name":            info.get("shortName") or info.get("longName"),
        "sector":          info.get("sector"),
        "industry":        info.get("industry"),
        # Valuation
        "market_cap":      info.get("marketCap"),
        "enterprise_value": info.get("enterpriseValue"),
        "pe_ratio":        safe("trailingPE"),
        "forward_pe":      safe("forwardPE"),
        "peg_ratio":       safe("pegRatio"),
        "price_to_book":   safe("priceToBook"),
        "price_to_sales":  safe("priceToSalesTrailing12Months"),
        "ev_to_ebitda":    safe("enterpriseToEbitda"),
        # Profitability
        "eps_ttm":         safe("trailingEps"),
        "eps_forward":     safe("forwardEps"),
        "profit_margin":   safe("profitMargins"),
        "operating_margin": safe("operatingMargins"),
        "roe":             safe("returnOnEquity"),
        "roa":             safe("returnOnAssets"),
        # Growth
        "revenue_growth":  safe("revenueGrowth"),
        "earnings_growth": safe("earningsGrowth"),
        "revenue_ttm":     info.get("totalRevenue"),
        # Balance sheet
        "total_cash":      info.get("totalCash"),
        "total_debt":      info.get("totalDebt"),
        "debt_to_equity":  safe("debtToEquity"),
        "current_ratio":   safe("currentRatio"),
        "quick_ratio":     safe("quickRatio"),
        # Dividend
        "dividend_yield":  safe("dividendYield"),
        "payout_ratio":    safe("payoutRatio"),
        # Float / short interest
        "shares_outstanding": info.get("sharesOutstanding"),
        "short_ratio":     safe("shortRatio"),
        "short_percent_float": safe("shortPercentOfFloat"),
        # 52-week range
        "fifty_two_week_high": safe("fiftyTwoWeekHigh"),
        "fifty_two_week_low":  safe("fiftyTwoWeekLow"),
        "beta":            safe("beta"),
    }

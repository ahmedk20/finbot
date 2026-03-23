"""
Point-in-time price lookup — used for historical news context.

Given an asset and an event date, returns the closing price at that date
and the prices 1d, 7d, and 30d after. This lets finbot-api show traders
what happened to the price following historically similar news events.

Uses yfinance to fetch a 35-day window around the event date.
Works for both crypto (BTC-USD) and stocks (NVDA, AAPL).
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

CRYPTO_MAP: dict[str, str] = {
    "BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
    "BNB": "BNB-USD", "XRP": "XRP-USD", "ADA": "ADA-USD",
    "AVAX": "AVAX-USD", "DOT": "DOT-USD", "MATIC": "MATIC-USD",
    "LINK": "LINK-USD", "UNI": "UNI-USD", "ATOM": "ATOM-USD",
    "LTC": "LTC-USD", "DOGE": "DOGE-USD", "NEAR": "NEAR-USD",
}


def _resolve_ticker(asset: str) -> str:
    upper = asset.upper()
    return CRYPTO_MAP.get(upper, upper)


def _nearest_close(df: pd.DataFrame, target: datetime) -> Optional[float]:
    """
    Find the closing price on or nearest to target date.
    Markets are closed on weekends/holidays — we look forward up to 3 days
    to find the next available trading day.
    """
    for offset in range(4):  # try target, +1, +2, +3
        candidate = (target + timedelta(days=offset)).strftime("%Y-%m-%d")
        if candidate in df.index:
            val = df.loc[candidate, "Close"]
            # yfinance sometimes returns a Series when multi-level columns exist
            if hasattr(val, "item"):
                val = val.item()
            return round(float(val), 6)
    return None


def _pct_change(base: Optional[float], later: Optional[float]) -> Optional[float]:
    if base is None or later is None or base == 0:
        return None
    return round((later - base) / base * 100, 2)


def fetch(asset: str, event_date: str) -> dict:
    """
    Fetch closing prices around an event date.

    Args:
        asset:      FinBot asset symbol (BTC, ETH, NVDA, AAPL...)
        event_date: ISO date string (YYYY-MM-DD)

    Returns:
        {
            asset, ticker, event_date,
            price_at_event,       # closing price on event day
            price_1d_after,       # closing price 1 day later
            price_7d_after,       # closing price 7 days later
            price_30d_after,      # closing price 30 days later
            change_1d_pct,        # % change from event to 1d
            change_7d_pct,        # % change from event to 7d
            change_30d_pct,       # % change from event to 30d
        }
    """
    ticker = _resolve_ticker(asset)
    event  = datetime.strptime(event_date, "%Y-%m-%d")

    # Fetch 35 days: 1 day before event → 32 days after
    # Extra day before handles weekends (event might fall on Monday, market closed Sat/Sun)
    start = (event - timedelta(days=1)).strftime("%Y-%m-%d")
    end   = (event + timedelta(days=33)).strftime("%Y-%m-%d")

    try:
        df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
        if df.empty:
            raise ValueError(f"No price data for {ticker} around {event_date}")

        # Flatten multi-level columns if present (yfinance >= 0.2 quirk)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        df.index = df.index.strftime("%Y-%m-%d")

    except Exception as e:
        raise ValueError(f"yfinance error for {ticker}: {e}")

    price_at   = _nearest_close(df, event)
    price_1d   = _nearest_close(df, event + timedelta(days=1))
    price_7d   = _nearest_close(df, event + timedelta(days=7))
    price_30d  = _nearest_close(df, event + timedelta(days=30))

    return {
        "asset":            asset.upper(),
        "ticker":           ticker,
        "event_date":       event_date,
        "price_at_event":   price_at,
        "price_1d_after":   price_1d,
        "price_7d_after":   price_7d,
        "price_30d_after":  price_30d,
        "change_1d_pct":    _pct_change(price_at, price_1d),
        "change_7d_pct":    _pct_change(price_at, price_7d),
        "change_30d_pct":   _pct_change(price_at, price_30d),
    }

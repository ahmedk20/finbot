"""
Insider transactions via yfinance.

Returns recent insider buy/sell activity for a stock.
Insider buying is generally bullish signal — executives buy when they believe
stock is undervalued.  Insider selling is neutral (tax, diversification, etc.)
so we weight buys more heavily than sells in signal computation.

Only meaningful for stocks.  Call get_asset_type() before calling fetch().
"""

import yfinance as yf
import logging
from typing import Optional
import pandas as pd

logger = logging.getLogger(__name__)


def fetch(ticker: str, last_n_days: int = 90) -> dict:
    """
    Fetch insider transactions for a stock.

    Args:
        ticker:      Stock ticker (e.g. 'NVDA')
        last_n_days: Filter to transactions within this many days (default: 90)

    Returns:
        dict with aggregate buy/sell counts, net shares, and list of recent transactions.

    Raises:
        ValueError: if yfinance returns no insider data.
    """
    stock = yf.Ticker(ticker.upper())

    try:
        df: pd.DataFrame = stock.insider_transactions
    except Exception as e:
        raise ValueError(f"yfinance failed to fetch insider transactions for {ticker}: {e}") from e

    if df is None or df.empty:
        # Some small-cap or non-US stocks don't have insider data
        return {
            "ticker":        ticker.upper(),
            "period_days":   last_n_days,
            "buy_count":     0,
            "sell_count":    0,
            "net_shares":    0,
            "total_value_usd": None,
            "transactions":  [],
        }

    # Filter to recent transactions
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=last_n_days)
    if "Start Date" in df.columns:
        df = df[pd.to_datetime(df["Start Date"], utc=True) >= cutoff]
    elif df.index.dtype.kind == "M":  # DatetimeIndex
        df = df[df.index >= cutoff]

    # Normalise column names — yfinance changes these occasionally
    col_map = {
        "Shares": "shares",
        "Value": "value",
        "URL": "url",
        "Text": "text",
        "Insider": "insider",
        "Position": "position",
        "Transaction": "transaction",
        "Start Date": "date",
    }
    df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})

    # Classify as buy vs sell
    def _is_buy(text: str) -> bool:
        if not isinstance(text, str):
            return False
        lower = text.lower()
        # "Purchase", "Automatic Purchase", "Gift In"
        return "purchase" in lower or "buy" in lower or "gift in" in lower

    transactions = []
    buy_shares  = 0
    sell_shares = 0
    buy_count   = 0
    sell_count  = 0
    total_value = 0.0

    for _, row in df.iterrows():
        text     = row.get("text", "") or ""
        shares   = row.get("shares")
        value    = row.get("value")
        is_buy   = _is_buy(text)

        try:
            shares_int = int(shares) if shares is not None else 0
        except (TypeError, ValueError):
            shares_int = 0

        try:
            value_float = float(value) if value is not None else 0.0
        except (TypeError, ValueError):
            value_float = 0.0

        if is_buy:
            buy_shares += shares_int
            buy_count  += 1
        else:
            sell_shares += shares_int
            sell_count  += 1

        total_value += value_float

        transactions.append({
            "insider":     row.get("insider"),
            "position":    row.get("position"),
            "transaction": row.get("transaction") or text,
            "shares":      shares_int,
            "value_usd":   value_float if value_float > 0 else None,
            "date":        str(row.get("date", "")),
            "is_buy":      is_buy,
        })

    return {
        "ticker":         ticker.upper(),
        "period_days":    last_n_days,
        "buy_count":      buy_count,
        "sell_count":     sell_count,
        "buy_shares":     buy_shares,
        "sell_shares":    sell_shares,
        "net_shares":     buy_shares - sell_shares,
        "total_value_usd": round(total_value, 2) if total_value > 0 else None,
        "transactions":   transactions[:20],  # cap at 20 most recent
    }

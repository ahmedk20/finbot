import yfinance as yf
import pandas_ta as ta
import pandas as pd
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Map FinBot asset symbols → YFinance tickers
CRYPTO_MAP: dict[str, str] = {
    "BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
    "BNB": "BNB-USD", "XRP": "XRP-USD", "ADA": "ADA-USD",
    "AVAX": "AVAX-USD", "DOT": "DOT-USD", "MATIC": "MATIC-USD",
    "LINK": "LINK-USD", "UNI": "UNI-USD", "ATOM": "ATOM-USD",
    "LTC": "LTC-USD", "XMR": "XMR-USD", "DOGE": "DOGE-USD",
    "SHIB": "SHIB-USD", "FTM": "FTM-USD", "NEAR": "NEAR-USD",
    "ALGO": "ALGO-USD", "ZEC": "ZEC-USD",
}

VALID_PERIODS = {"1mo", "3mo", "6mo", "1y", "2y"}


def _resolve_ticker(asset: str) -> str:
    upper = asset.upper()
    return CRYPTO_MAP.get(upper, upper)  # fallback: pass through (handles stock tickers too)


def _fetch_ohlcv(ticker: str, period: str) -> pd.DataFrame:
    df = yf.download(ticker, period=period, auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError(f"No OHLCV data returned for {ticker}")
    # yfinance returns MultiIndex columns when single ticker — flatten
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def compute(asset: str, period: str = "3mo", indicators: Optional[list[str]] = None) -> dict:
    """
    Compute technical indicators for an asset.

    Args:
        asset:      FinBot symbol (BTC, ETH, NVDA, etc.)
        period:     YFinance period string (1mo, 3mo, 6mo, 1y, 2y)
        indicators: list of indicators to compute — None = all

    Returns:
        dict with latest values for each requested indicator
    """
    if period not in VALID_PERIODS:
        period = "3mo"

    all_indicators = indicators or ["rsi", "macd", "bb", "ema", "atr", "vwap"]
    ticker = _resolve_ticker(asset)

    try:
        df = _fetch_ohlcv(ticker, period)
    except Exception as e:
        raise ValueError(f"Failed to fetch OHLCV for {asset} ({ticker}): {e}") from e

    close = df["Close"].squeeze()
    high  = df["High"].squeeze()
    low   = df["Low"].squeeze()
    vol   = df["Volume"].squeeze()

    result: dict = {"asset": asset, "ticker": ticker, "period": period, "candles": len(df)}

    try:
        if "rsi" in all_indicators:
            rsi = ta.rsi(close, length=14)
            result["rsi"] = round(float(rsi.iloc[-1]), 2) if rsi is not None else None

        if "macd" in all_indicators:
            macd_df = ta.macd(close)
            if macd_df is not None:
                result["macd"] = {
                    "macd":   round(float(macd_df.iloc[-1, 0]), 4),
                    "signal": round(float(macd_df.iloc[-1, 1]), 4),
                    "hist":   round(float(macd_df.iloc[-1, 2]), 4),
                }

        if "bb" in all_indicators:
            bb_df = ta.bbands(close)
            if bb_df is not None:
                result["bb"] = {
                    "upper": round(float(bb_df.iloc[-1, 0]), 4),
                    "mid":   round(float(bb_df.iloc[-1, 1]), 4),
                    "lower": round(float(bb_df.iloc[-1, 2]), 4),
                    "width": round(float(bb_df.iloc[-1, 3]), 6),
                    "pct_b": round(float(bb_df.iloc[-1, 4]), 4),
                }

        if "ema" in all_indicators:
            result["ema"] = {
                "ema_9":  round(float(ta.ema(close, length=9).iloc[-1]), 4),
                "ema_20": round(float(ta.ema(close, length=20).iloc[-1]), 4),
                "ema_50": round(float(ta.ema(close, length=50).iloc[-1]), 4),
            }

        if "atr" in all_indicators:
            atr = ta.atr(high, low, close, length=14)
            result["atr"] = round(float(atr.iloc[-1]), 4) if atr is not None else None

        if "vwap" in all_indicators:
            # pandas-ta vwap needs DatetimeIndex
            df_copy = df.copy()
            df_copy.index = pd.to_datetime(df_copy.index)
            vwap = ta.vwap(high, low, close, vol)
            result["vwap"] = round(float(vwap.iloc[-1]), 4) if vwap is not None else None

    except Exception as e:
        logger.warning(f"Indicator computation error for {asset}: {e}")

    return result

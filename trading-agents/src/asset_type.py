"""
Asset type classifier — maps a ticker symbol to 'crypto' | 'stock' | 'unknown'.

Lookup table approach: O(1), zero latency, zero external calls.
No external dependency means this never fails. The list covers the assets our
news-scraper tracks + the top-100 stocks by market cap.

When to extend: add new assets to the appropriate set below, then redeploy.
No code logic changes required.
"""

from typing import Literal

AssetType = Literal["crypto", "stock", "unknown"]

# ── Crypto ────────────────────────────────────────────────────────────────────
# Top crypto assets + all assets tracked by our news-scraper
CRYPTO_TICKERS: frozenset[str] = frozenset({
    # Layer 1 — Bitcoin, Ethereum
    "BTC", "ETH",
    # Layer 1 alts
    "SOL", "BNB", "XRP", "ADA", "AVAX", "DOT", "MATIC", "POL",
    "LINK", "UNI", "ATOM", "LTC", "XMR", "DOGE", "SHIB", "FTM",
    "NEAR", "ALGO", "ZEC",
    # DeFi
    "AAVE", "MKR", "COMP", "CRV", "SNX", "YFI", "BAL",
    "SUSHI", "1INCH", "LDO", "RPL", "FXS", "CVX",
    # L2 / infrastructure
    "OP", "ARB", "IMX", "DYDX", "MANTA", "SCROLL",
    # Newer large caps
    "TON", "SUI", "APT", "INJ", "SEI", "TIA", "PYTH", "JTO",
    # Meme / high volume
    "BONK", "WIF", "PEPE", "FLOKI", "BRETT",
    # Stablecoins (excluded from analysis but listed to avoid 'unknown')
    "USDT", "USDC", "DAI", "BUSD", "TUSD",
    # ENS
    "ENS",
})

# ── Stocks ────────────────────────────────────────────────────────────────────
# Top 100 US stocks by market cap + common ETFs
STOCK_TICKERS: frozenset[str] = frozenset({
    # Big tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "QCOM", "TXN",
    "AMAT", "LRCX", "KLAC", "MU",
    # Finance
    "BRK.B", "BRK.A", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS",
    "AXP", "BLK", "C", "SCHW", "CB", "SPGI",
    # Healthcare
    "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT",
    "DHR", "MDT", "ISRG", "CVS", "CI",
    # Consumer
    "WMT", "PG", "KO", "PEP", "COST", "MCD", "SBUX", "NKE", "HD", "LOW",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG",
    # Industrial
    "CAT", "DE", "HON", "GE", "RTX", "LMT", "BA", "UPS", "FDX",
    # Telecom / media
    "T", "VZ", "NFLX", "DIS", "CMCSA",
    # ETFs (common as analysis targets)
    "SPY", "QQQ", "IWM", "GLD", "TLT", "XLF", "XLK",
})


def get_asset_type(ticker: str) -> AssetType:
    """
    Classify a ticker as crypto, stock, or unknown.

    Normalises common suffixes before lookup:
      - '-USD', '-USDT', '-USDC' (e.g. 'BTC-USD' → 'BTC')
      - Strips whitespace, uppercases

    Returns 'unknown' for anything not in the lookup tables.
    The caller decides how to handle 'unknown' — typically treat as stock
    (yfinance will just fail gracefully if the ticker doesn't exist).
    """
    if not ticker:
        return "unknown"

    normalised = (
        ticker.upper()
        .strip()
        .replace("-USD", "")
        .replace("-USDT", "")
        .replace("-USDC", "")
        .replace("-PERP", "")
    )

    if normalised in CRYPTO_TICKERS:
        return "crypto"
    if normalised in STOCK_TICKERS:
        return "stock"
    return "unknown"

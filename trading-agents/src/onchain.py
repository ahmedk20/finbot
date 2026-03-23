"""
Crypto market data via CoinGecko free public API.

CoinGecko free tier:
  - No API key required for /coins/{id}/... endpoints
  - Rate limit: ~10-30 requests/minute depending on IP region
  - Returns: price, market cap, volume, circulating supply, price change

Note: CoinGecko uses its own coin IDs ('bitcoin', 'ethereum') not tickers.
We map common tickers to CoinGecko IDs here.  Unknown tickers fall back to
lowercase ticker as the ID (often works for lesser-known coins).
"""

import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# FinBot ticker → CoinGecko coin ID
COINGECKO_IDS: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "AVAX": "avalanche-2",
    "DOT": "polkadot",
    "MATIC": "matic-network",
    "POL": "matic-network",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "ATOM": "cosmos",
    "LTC": "litecoin",
    "XMR": "monero",
    "DOGE": "dogecoin",
    "SHIB": "shiba-inu",
    "NEAR": "near",
    "ALGO": "algorand",
    "FTM": "fantom",
    "AAVE": "aave",
    "MKR": "maker",
    "COMP": "compound-governance-token",
    "CRV": "curve-dao-token",
    "OP": "optimism",
    "ARB": "arbitrum",
    "TON": "the-open-network",
    "SUI": "sui",
    "APT": "aptos",
    "INJ": "injective-protocol",
    "SEI": "sei-network",
    "TIA": "celestia",
    "PEPE": "pepe",
    "BONK": "bonk",
    "WIF": "dogwifcoin",
}


def _resolve_coin_id(asset: str) -> str:
    """Map FinBot ticker to CoinGecko coin ID."""
    normalised = asset.upper().replace("-USD", "").replace("-USDT", "")
    return COINGECKO_IDS.get(normalised, normalised.lower())


def fetch(asset: str) -> dict:
    """
    Fetch crypto market data from CoinGecko.

    Args:
        asset: FinBot ticker (BTC, ETH, SOL, etc.)

    Returns:
        dict with price, market cap, volume, dominance, and sentiment data.

    Raises:
        ValueError: if CoinGecko returns no data or coin ID not found.
    """
    coin_id = _resolve_coin_id(asset)

    url = f"{COINGECKO_BASE}/coins/{coin_id}"
    params = {
        "localization": "false",
        "tickers": "false",
        "community_data": "true",
        "developer_data": "false",
        "sparkline": "false",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, params=params)
    except httpx.TimeoutException as e:
        raise ValueError(f"CoinGecko request timed out for {asset}: {e}") from e
    except httpx.RequestError as e:
        raise ValueError(f"CoinGecko request failed for {asset}: {e}") from e

    if resp.status_code == 404:
        raise ValueError(f"Coin '{coin_id}' not found on CoinGecko — check the COINGECKO_IDS mapping")
    if resp.status_code == 429:
        raise ValueError("CoinGecko rate limit hit — reduce request frequency or add a pause")
    if resp.status_code != 200:
        raise ValueError(f"CoinGecko returned HTTP {resp.status_code} for {asset}")

    data = resp.json()
    mkt = data.get("market_data", {})

    def price(key: str, currency: str = "usd") -> Optional[float]:
        val = mkt.get(key, {}).get(currency)
        return round(float(val), 8) if val is not None else None

    def flat(key: str) -> Optional[float]:
        val = mkt.get(key)
        return round(float(val), 4) if val is not None else None

    community = data.get("community_data", {})

    return {
        "asset":                   asset.upper().replace("-USD", ""),
        "coin_id":                 coin_id,
        "name":                    data.get("name"),
        # Price
        "price_usd":               price("current_price"),
        "price_change_24h_pct":    price("price_change_percentage_24h_in_currency"),
        "price_change_7d_pct":     price("price_change_percentage_7d_in_currency"),
        "ath_usd":                 price("ath"),
        "ath_change_pct":          price("ath_change_percentage"),
        # Market
        "market_cap_usd":          price("market_cap"),
        "market_cap_rank":         data.get("market_cap_rank"),
        "fully_diluted_valuation": price("fully_diluted_valuation"),
        "total_volume_24h_usd":    price("total_volume"),
        # Supply
        "circulating_supply":      flat("circulating_supply"),
        "total_supply":            flat("total_supply"),
        "max_supply":              flat("max_supply"),
        # Community (proxy for social sentiment)
        "twitter_followers":       community.get("twitter_followers"),
        "reddit_subscribers":      community.get("reddit_subscribers"),
        "reddit_active_accounts":  community.get("reddit_accounts_active_48h"),
        # CoinGecko sentiment votes
        "sentiment_votes_up_pct":  data.get("sentiment_votes_up_percentage"),
        "sentiment_votes_down_pct": data.get("sentiment_votes_down_percentage"),
    }

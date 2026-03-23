"""
FRED economic indicators — macro context for signal engine.

Fetches four key indicators from the Federal Reserve's FRED API:
  - Fed Funds Rate  (FEDFUNDS)   — cost of money, monthly
  - CPI YoY         (CPIAUCSL)   — inflation pressure, monthly
  - Unemployment    (UNRATE)     — labour market health, monthly
  - Real GDP growth (A191RL1Q225SBEA) — economic momentum, quarterly

Why these four:
  - Fed rate rising  → expensive capital → bearish for risk assets
  - CPI rising       → Fed forced to tighten → bearish
  - Unemployment low → strong economy → risk-on → bullish
  - GDP contracting  → recession risk → risk-off → bearish

Each indicator is converted to a score in [-1, +1].
Composite = simple average of available scores.

FRED API is free. Register at fred.stlouisfed.org.
If FRED_API_KEY is not configured, returns degraded=True with nulls.
"""

import urllib.request
import json
import logging
from typing import Optional
from src.config import settings

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"


# ─── FRED fetcher ──────────────────────────────────────────────────────────────

def _fetch_latest(series_id: str, units: str = "lin") -> Optional[float]:
    """
    Fetch the most recent observation for a FRED series.

    Args:
        series_id: FRED series identifier (e.g. "FEDFUNDS")
        units:     lin = raw value | pc1 = percent change from year ago

    Returns:
        Latest value as float, or None if unavailable.
    """
    key = settings.FRED_API_KEY or ""
    if not key or key.startswith("your_"):
        return None

    url = (
        f"{FRED_BASE}"
        f"?series_id={series_id}"
        f"&api_key={key}"
        f"&file_type=json"
        f"&limit=1"
        f"&sort_order=desc"
        f"&units={units}"
    )

    try:
        with urllib.request.urlopen(url, timeout=8) as res:
            data = json.loads(res.read())

        observations = data.get("observations", [])
        if not observations:
            return None

        value = observations[0].get("value", ".")
        if value == "." or value is None:   # FRED uses "." for missing
            return None

        return round(float(value), 4)

    except Exception as e:
        logger.warning(f"FRED fetch failed for {series_id}: {e}")
        return None


# ─── Scoring functions ─────────────────────────────────────────────────────────

def _score_fed_rate(rate: float) -> float:
    """
    Fed Funds Rate (%) → signal score.
    Low rates = cheap money = bullish for risk assets.
    High rates = expensive money = bearish.

    Historical context: 0-1% (COVID era) was ultra-bullish.
    5%+ (post-2022 hikes) was significantly bearish for crypto/growth.
    """
    if rate <= 1.0:  return  0.8
    if rate <= 2.5:  return  0.3
    if rate <= 4.0:  return  0.0
    if rate <= 5.5:  return -0.5
    return                  -0.9


def _score_cpi(cpi_yoy_pct: float) -> float:
    """
    CPI year-over-year % change → signal score.
    Fed target is 2%. Above target → tightening pressure → bearish.
    Below target → easing possible → bullish.
    """
    if cpi_yoy_pct <= 2.0:  return  0.6
    if cpi_yoy_pct <= 3.5:  return  0.0
    if cpi_yoy_pct <= 5.0:  return -0.5
    return                          -0.9


def _score_unemployment(rate: float) -> float:
    """
    Unemployment rate (%) → signal score.
    Low unemployment = strong labour market = risk-on = bullish.
    High unemployment = economic weakness = risk-off = bearish.
    """
    if rate <= 4.0:  return  0.4
    if rate <= 5.0:  return  0.0
    if rate <= 6.5:  return -0.3
    return                  -0.7


def _score_gdp(growth_pct: float) -> float:
    """
    Real GDP growth (annualised %) → signal score.
    Positive growth = expanding economy = bullish.
    Negative = contraction = recession risk = bearish.
    """
    if growth_pct >= 3.0:  return  0.6
    if growth_pct >= 1.5:  return  0.2
    if growth_pct >= 0.0:  return -0.1
    return                         -0.8


# ─── Public API ───────────────────────────────────────────────────────────────

def fetch() -> dict:
    """
    Fetch all four FRED indicators and compute a composite macro score.

    Returns:
        {
            fed_rate:        float | None,
            cpi_yoy:         float | None,   # percent change from year ago
            unemployment:    float | None,
            gdp_growth:      float | None,
            composite_score: float | None,   # -1 (bearish) to +1 (bullish)
            degraded:        bool,           # True if FRED_API_KEY missing
            available_count: int,            # how many indicators returned data
        }
    """
    key = settings.FRED_API_KEY or ""
    if not key or key.startswith("your_"):
        logger.warning("FRED_API_KEY not configured — economic indicators unavailable")
        return {
            "fed_rate":        None,
            "cpi_yoy":         None,
            "unemployment":    None,
            "gdp_growth":      None,
            "composite_score": None,
            "degraded":        True,
            "available_count": 0,
        }

    fed_rate     = _fetch_latest("FEDFUNDS")
    cpi_yoy      = _fetch_latest("CPIAUCSL",        units="pc1")  # YoY % change
    unemployment = _fetch_latest("UNRATE")
    gdp_growth   = _fetch_latest("A191RL1Q225SBEA")               # real GDP, annualised %

    scores: list[float] = []
    if fed_rate     is not None: scores.append(_score_fed_rate(fed_rate))
    if cpi_yoy      is not None: scores.append(_score_cpi(cpi_yoy))
    if unemployment is not None: scores.append(_score_unemployment(unemployment))
    if gdp_growth   is not None: scores.append(_score_gdp(gdp_growth))

    composite = round(sum(scores) / len(scores), 4) if scores else None

    return {
        "fed_rate":        fed_rate,
        "cpi_yoy":         cpi_yoy,
        "unemployment":    unemployment,
        "gdp_growth":      gdp_growth,
        "composite_score": composite,
        "degraded":        False,
        "available_count": len(scores),
    }

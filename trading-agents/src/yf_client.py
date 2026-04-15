"""
Centralized yfinance configuration.

Yahoo Finance aggressively rate-limits / blocks datacenter IPs.
Two mitigations are applied here:

  1. Retry with exponential back-off (handles transient blocks/timeouts)
  2. Optional HTTP proxy via YFINANCE_PROXY env var.
     curl_cffi (used internally by yfinance) respects HTTP_PROXY /
     HTTPS_PROXY environment variables, so we set them at import time
     if YFINANCE_PROXY is configured.

Usage:

    from src.yf_client import yf_retry

    @yf_retry()
    def _download(ticker: str, **kwargs):
        return yf.download(ticker, **kwargs)
"""

import os
import time
import logging
from functools import wraps
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

# ── Proxy setup ───────────────────────────────────────────────────────────────
_proxy = os.environ.get("YFINANCE_PROXY")
if _proxy:
    os.environ.setdefault("HTTP_PROXY", _proxy)
    os.environ.setdefault("HTTPS_PROXY", _proxy)
    logger.info("yfinance: routing requests through proxy %s", _proxy)

# ── Retry decorator ───────────────────────────────────────────────────────────
# Keywords that indicate a transient network failure worth retrying.
# Data errors (bad ticker, empty response) are NOT retried.
_RETRYABLE_KEYWORDS = ("timeout", "timed out", "connection", "errno 110", "errno 111")

F = TypeVar("F", bound=Callable)


def yf_retry(retries: int = 3, base_delay: float = 3.0):
    """
    Decorator — retries a yfinance call with exponential back-off.

    Only retries on connection/timeout errors; propagates data errors immediately
    so callers get a fast failure on bad tickers or empty results.

    Args:
        retries:    Maximum number of attempts (default 3 → up to 3+12+... seconds wait).
        base_delay: Seconds before first retry; doubles each attempt (3s, 6s, 12s...).
    """
    def decorator(fn: F) -> F:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc: Exception = RuntimeError("no attempts made")
            for attempt in range(retries):
                try:
                    return fn(*args, **kwargs)
                except Exception as e:
                    msg = str(e).lower()
                    if not any(kw in msg for kw in _RETRYABLE_KEYWORDS):
                        raise  # data/logic error — don't retry
                    last_exc = e
                    if attempt < retries - 1:
                        delay = base_delay * (2 ** attempt)
                        logger.warning(
                            "yfinance network error (attempt %d/%d), retrying in %.0fs: %s",
                            attempt + 1, retries, delay, e,
                        )
                        time.sleep(delay)
                    else:
                        logger.error(
                            "yfinance network error — all %d attempts exhausted: %s",
                            retries, e,
                        )
            raise last_exc
        return wrapper  # type: ignore[return-value]
    return decorator

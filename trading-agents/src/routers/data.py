"""
Data endpoints — fundamentals, on-chain, insiders, asset type classification.

All endpoints:
  - Protected by X-Internal-Key header
  - Run synchronous code in FastAPI's threadpool (run_in_executor)
  - Return 422 if the asset type doesn't match the endpoint
"""

import asyncio
from functools import partial
from fastapi import APIRouter, Depends, HTTPException
from src.middleware import verify_internal_key
from src.schemas import (
    AssetTypeRequest, AssetTypeResponse,
    FundamentalsRequest, FundamentalsResponse,
    OnchainRequest, OnchainResponse,
    InsidersRequest, InsidersResponse,
    PriceHistoryRequest, PriceHistoryResponse,
    EconomicResponse,
)
from src.asset_type import get_asset_type
from src import fundamentals, onchain, insiders, price_history, economic

router = APIRouter(prefix="/data", tags=["data"])


@router.post(
    "/asset-type",
    response_model=AssetTypeResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def classify_asset(req: AssetTypeRequest) -> AssetTypeResponse:
    """Classify a ticker as crypto | stock | unknown."""
    asset_type = get_asset_type(req.asset)
    return AssetTypeResponse(asset=req.asset.upper(), asset_type=asset_type)


@router.post(
    "/fundamentals",
    response_model=FundamentalsResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def get_fundamentals(req: FundamentalsRequest) -> FundamentalsResponse:
    """
    Fetch stock fundamentals (P/E, EPS, revenue, balance sheet...) via yfinance.
    Only valid for stock tickers — returns 422 for crypto assets.
    """
    asset_type = get_asset_type(req.ticker)
    if asset_type == "crypto":
        raise HTTPException(
            status_code=422,
            detail=f"{req.ticker} is a crypto asset — fundamentals (P/E, EPS) are not applicable. Use /data/onchain instead.",
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, partial(fundamentals.fetch, req.ticker))
        return FundamentalsResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post(
    "/onchain",
    response_model=OnchainResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def get_onchain(req: OnchainRequest) -> OnchainResponse:
    """
    Fetch crypto market data from CoinGecko (price, market cap, volume, social metrics).
    Only valid for crypto assets — returns 422 for stock tickers.
    """
    asset_type = get_asset_type(req.asset)
    if asset_type == "stock":
        raise HTTPException(
            status_code=422,
            detail=f"{req.asset} is a stock — use /data/fundamentals instead.",
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, partial(onchain.fetch, req.asset))
        return OnchainResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post(
    "/insiders",
    response_model=InsidersResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def get_insiders(req: InsidersRequest) -> InsidersResponse:
    """
    Fetch insider buy/sell transactions for a stock via yfinance.
    Only valid for stock tickers — returns 422 for crypto assets.
    """
    asset_type = get_asset_type(req.ticker)
    if asset_type == "crypto":
        raise HTTPException(
            status_code=422,
            detail=f"{req.ticker} is a crypto asset — insider transactions don't exist for crypto.",
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(insiders.fetch, req.ticker, req.last_n_days),
        )
        return InsidersResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post(
    "/price-history",
    response_model=PriceHistoryResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def get_price_history(req: PriceHistoryRequest) -> PriceHistoryResponse:
    """
    Return closing prices around a historical event date.
    Used by finbot-api to show traders what happened to the price
    after historically similar news events occurred.
    """
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(price_history.fetch, req.asset, req.event_date),
        )
        return PriceHistoryResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post(
    "/economic",
    response_model=EconomicResponse,
    dependencies=[Depends(verify_internal_key)],
)
async def get_economic(_: None = None) -> EconomicResponse:
    """
    Fetch macro economic indicators from FRED (Fed rate, CPI, unemployment, GDP).
    Returns a composite score in [-1, +1] for use in the signal engine.
    Degrades gracefully — returns degraded=True if FRED_API_KEY is not configured.
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, economic.fetch)
    return EconomicResponse(**result)

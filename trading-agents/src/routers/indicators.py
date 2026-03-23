from fastapi import APIRouter, Depends, HTTPException
from src.schemas import IndicatorsRequest, IndicatorsResponse
from src.middleware import verify_internal_key
from src import indicators as ind_service

router = APIRouter(prefix="/indicators", tags=["indicators"])


@router.post("/", response_model=IndicatorsResponse, dependencies=[Depends(verify_internal_key)])
async def get_indicators(req: IndicatorsRequest) -> IndicatorsResponse:
    """
    Compute technical indicators (RSI, MACD, BB, EMA, ATR, VWAP) for any asset.
    Supports crypto (BTC, ETH, SOL...) and stocks (NVDA, AAPL...) via YFinance.
    """
    import asyncio
    from functools import partial

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(ind_service.compute, req.asset, req.period, req.indicators),
        )
        return IndicatorsResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

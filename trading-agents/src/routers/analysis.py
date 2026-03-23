import logging
import traceback
from fastapi import APIRouter, Depends, HTTPException
from src.schemas import AnalyzeRequest, AnalyzeResponse
from src.middleware import verify_internal_key
from src import trading_agents

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analysis"])


@router.post("/", response_model=AnalyzeResponse, dependencies=[Depends(verify_internal_key)])
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run full TradingAgents multi-agent pipeline.
    Analysts → Bull/Bear debate → Research Manager → Trader → Risk debate → Decision.
    Slow by design (~30-120s). Called by finbot-api BullMQ worker, not directly.
    """
    try:
        return await trading_agents.analyze(req)
    except Exception as e:
        logger.error("Analysis failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail="Analysis pipeline failed — check server logs")

from fastapi import APIRouter, Depends
from src.schemas import CompleteRequest, CompleteResponse
from src.middleware import verify_internal_key
from src import llm as llm_service

router = APIRouter(prefix="/llm", tags=["llm"])


@router.post("/complete", response_model=CompleteResponse, dependencies=[Depends(verify_internal_key)])
async def complete(req: CompleteRequest) -> CompleteResponse:
    """
    Unified LLM completion endpoint with automatic fallback chain.
    Groq → Gemini → OpenAI → Anthropic
    """
    return await llm_service.complete(req)

import logging
from fastapi import FastAPI
from src.routers import llm, analysis, indicators
from src.routers import data

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

app = FastAPI(
    title="FinBot Trading Agents",
    description="Internal microservice — LLM gateway, technical indicators, TradingAgents analysis, and market data.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
)

app.include_router(llm.router)
app.include_router(analysis.router)
app.include_router(indicators.router)
app.include_router(data.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}

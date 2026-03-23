from fastapi import FastAPI
from src.routers import llm, analysis, indicators, data

app = FastAPI(title="FinBot Trading Agents", version="1.0.0", docs_url="/docs")

app.include_router(llm.router)
app.include_router(analysis.router)
app.include_router(indicators.router)
app.include_router(data.router)


@app.get("/health")
async def health():
    return {"status": "ok"}

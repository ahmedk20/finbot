from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Internal auth — finbot-api must send this header on every request
    INTERNAL_KEY: str

    # LLM providers for LiteLLM gateway (/llm/complete)
    GROQ_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None

    # LiteLLM fallback chain — ordered, first available wins
    LLM_FALLBACK_CHAIN: str = (
        "groq/llama-3.1-70b-versatile,"
        "gemini/gemini-1.5-flash,"
        "openai/gpt-4o-mini,"
        "anthropic/claude-haiku-4-5-20251001"
    )

    # FRED — free API key at fred.stlouisfed.org
    FRED_API_KEY: Optional[str] = None

    # TradingAgents config
    # Which provider TradingAgents uses for its own LLM calls
    TA_LLM_PROVIDER: str = "openai"          # openai | anthropic | google | xai | openrouter | ollama | groq
    TA_BACKEND_URL: Optional[str] = None     # custom OpenAI-compatible base URL (e.g. MiMo, local LLM)
    TA_DEEP_THINK_LLM: str = "gpt-4o"        # for bull/bear debate, risk debate
    TA_QUICK_THINK_LLM: str = "gpt-4o-mini"  # for analysts, signal extraction
    TA_MAX_DEBATE_ROUNDS: int = 1
    TA_MAX_RISK_ROUNDS: int = 1

    class Config:
        env_file = ".env"


settings = Settings()

LLM_MODELS: list[str] = [m.strip() for m in settings.LLM_FALLBACK_CHAIN.split(",")]

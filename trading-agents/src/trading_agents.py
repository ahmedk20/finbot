import logging
from src.config import settings
from src.schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger(__name__)


def _build_config() -> dict:
    """Build TradingAgents config from env settings."""
    from tradingagents.default_config import DEFAULT_CONFIG

    cfg = DEFAULT_CONFIG.copy()
    cfg["llm_provider"]          = settings.TA_LLM_PROVIDER
    cfg["deep_think_llm"]        = settings.TA_DEEP_THINK_LLM
    cfg["quick_think_llm"]       = settings.TA_QUICK_THINK_LLM
    if settings.TA_BACKEND_URL:
        cfg["backend_url"]       = settings.TA_BACKEND_URL
    cfg["max_debate_rounds"]     = settings.TA_MAX_DEBATE_ROUNDS
    cfg["max_risk_discuss_rounds"] = settings.TA_MAX_RISK_ROUNDS
    # NOTE: selected_analysts is NOT a config dict key.
    # It is a constructor parameter: TradingAgentsGraph(selected_analysts=[...])
    # Putting it in cfg has no effect — confirmed from trading_graph.py source.
    return cfg


async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run TradingAgents full multi-agent analysis pipeline.
    Wraps TradingAgentsGraph.propagate() — synchronous but run in threadpool
    via FastAPI's run_in_executor to avoid blocking the event loop.
    """
    import asyncio
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    cfg = _build_config()

    def _run() -> tuple:
        # selected_analysts must be a constructor arg — confirmed from source:
        # TradingAgentsGraph.__init__(self, selected_analysts=[...], debug=False, config={...})
        # The graph is compiled once at __init__ time based on selected_analysts,
        # so passing it later (e.g. in config) has no effect.
        ta = TradingAgentsGraph(
            selected_analysts=req.analysts,
            debug=False,
            config=cfg,
        )
        return ta.propagate(req.ticker, req.date)

    loop = asyncio.get_running_loop()
    final_state, decision = await loop.run_in_executor(None, _run)

    return AnalyzeResponse(
        ticker=req.ticker,
        date=req.date,
        decision=decision,
        market_report=final_state.get("market_report"),
        sentiment_report=final_state.get("sentiment_report"),
        news_report=final_state.get("news_report"),
        fundamentals_report=final_state.get("fundamentals_report"),
        investment_plan=final_state.get("investment_plan"),
        final_trade_decision=final_state.get("final_trade_decision"),
    )

import litellm
from litellm.exceptions import RateLimitError, ServiceUnavailableError, APIError
from src.config import settings, LLM_MODELS
from src.schemas import CompleteRequest, CompleteResponse
import logging

logger = logging.getLogger(__name__)

# Pass provider keys to litellm via env — it picks them up automatically
litellm.groq_key = settings.GROQ_API_KEY
litellm.gemini_key = settings.GEMINI_API_KEY
litellm.openai_key = settings.OPENAI_API_KEY
litellm.anthropic_key = settings.ANTHROPIC_API_KEY

# Suppress litellm's verbose logging in production
litellm.suppress_debug_info = True


async def complete(req: CompleteRequest) -> CompleteResponse:
    """
    Call LLM with fallback chain: Groq → Gemini → OpenAI → Anthropic.
    Tries each provider in order until one succeeds.
    """
    models = [req.model] if req.model else LLM_MODELS
    messages = [m.model_dump() for m in req.messages]
    last_err: Exception | None = None

    for model in models:
        try:
            response = await litellm.acompletion(
                model=model,
                messages=messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )
            choice = response.choices[0].message
            usage = response.usage

            return CompleteResponse(
                content=choice.content or "",
                model_used=model,
                input_tokens=usage.prompt_tokens,
                output_tokens=usage.completion_tokens,
            )

        except (RateLimitError, ServiceUnavailableError) as e:
            logger.warning(f"Provider {model} unavailable: {e} — trying next")
            last_err = e
            continue

        except APIError as e:
            logger.warning(f"Provider {model} API error: {e} — trying next")
            last_err = e
            continue

    raise RuntimeError(f"All LLM providers failed. Last error: {last_err}")

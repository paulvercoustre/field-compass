"""
Why an AI call failed, in terms a caller can act on.

A failed call used to be returned as an empty result, which the qualitative
worker stored as "success": every submission looked checked and clean while
the provider was rejecting the key. Callers now get an :class:`AIError`
naming one of a few categories, and whether trying again can help.

The category is stored as the prefix of ``llm_last_error``
(``"auth: Incorrect API key provided"``) so the UI can choose its wording
without parsing provider messages.
"""

import re
from dataclasses import dataclass

import openai

AUTH = "auth"
PROVIDER_QUOTA = "provider_quota"
RATE_LIMITED = "rate_limited"
UNAVAILABLE = "unavailable"
TIMEOUT = "timeout"
BAD_RESPONSE = "bad_response"
BAD_REQUEST = "bad_request"
NOT_CONFIGURED = "not_configured"

RETRYABLE = frozenset({RATE_LIMITED, UNAVAILABLE, TIMEOUT, BAD_RESPONSE})

# Longest wait honoured from a provider's Retry-After, in seconds. A longer
# wait is better spent failing and retrying on the next pull.
_MAX_RETRY_AFTER = 300

# OpenAI's codes for an account with no credit left, as opposed to a request
# rate limit. Both arrive as HTTP 429.
_QUOTA_CODES = frozenset({"insufficient_quota", "billing_hard_limit_reached"})


@dataclass(eq=False)
class AIError(Exception):
    category: str
    message: str
    retry_after: float | None = None

    def __post_init__(self) -> None:
        # Populate args so the error survives Celery's serialisation on retry.
        super().__init__(self.category, self.message)

    def __str__(self) -> str:
        return f"{self.category}: {self.message}"

    @property
    def retryable(self) -> bool:
        return self.category in RETRYABLE


def _retry_after(exc: openai.APIStatusError) -> float | None:
    try:
        value = float(exc.response.headers.get("retry-after", ""))
    except (TypeError, ValueError):
        return None
    return min(max(value, 0.0), _MAX_RETRY_AFTER)


def _provider_message(exc: openai.APIStatusError) -> str:
    """The provider's own wording, not the SDK's ``Error code: 429 - {...}`` wrapper."""
    body = exc.body
    if isinstance(body, dict):
        inner = body.get("error") if isinstance(body.get("error"), dict) else body
        if inner.get("message"):
            return str(inner["message"])
    return exc.response.text or f"HTTP {exc.status_code}"


# Providers echo part of a rejected key ("sk-inval****ting"). Stored errors
# are shown to everyone with access to the survey, so no part of a key stays.
_KEY_FRAGMENT = re.compile(r"\b(?:sk|key|api[-_]?key)[-_][A-Za-z0-9*_-]{4,}", re.IGNORECASE)


def _short(text: object, limit: int = 300) -> str:
    cleaned = _KEY_FRAGMENT.sub("[key hidden]", " ".join(str(text).split()))
    return cleaned[:limit]


def classify(exc: Exception) -> AIError:
    """Map an exception from the OpenAI SDK (or any other) to an AIError."""
    if isinstance(exc, AIError):
        return exc

    # APITimeoutError subclasses APIConnectionError, so it goes first.
    if isinstance(exc, openai.APITimeoutError):
        return AIError(TIMEOUT, "The AI provider did not answer in time.")
    if isinstance(exc, openai.APIConnectionError):
        return AIError(UNAVAILABLE, "Could not reach the AI provider.")

    if isinstance(exc, openai.APIStatusError):
        message = _short(_provider_message(exc))
        status = exc.status_code
        if status in (401, 403):
            return AIError(AUTH, message)
        if status == 402 or getattr(exc, "code", None) in _QUOTA_CODES:
            return AIError(PROVIDER_QUOTA, message)
        if status == 429:
            return AIError(RATE_LIMITED, message, retry_after=_retry_after(exc))
        if status >= 500:
            return AIError(UNAVAILABLE, message, retry_after=_retry_after(exc))
        return AIError(BAD_REQUEST, message)

    return AIError(BAD_RESPONSE, _short(f"{type(exc).__name__}: {exc}"))

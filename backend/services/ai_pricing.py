"""
What an AI call cost, at list price, when it was made.

The cost is worked out from a price table and stored on the ``ai_usage``
row, so a later price change never rewrites what past calls cost. Stored as
integer micro-dollars: one check is a fraction of a cent.

The table is ``services/ai_prices.json`` (USD per 1M tokens), or the file
named by ``AI_PRICES_FILE``. A model it does not list -- an Azure deployment
name, a self-hosted model -- is recorded with no cost rather than a guess.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path

from settings import get_settings

logger = logging.getLogger(__name__)

_DEFAULT_FILE = Path(__file__).with_name("ai_prices.json")
# "gpt-5-mini-2025-08-07" is priced as "gpt-5-mini"; "openai/gpt-4o-mini"
# (OpenRouter's naming) as "gpt-4o-mini".
_DATED_SNAPSHOT = re.compile(r"-\d{4}-\d{2}-\d{2}$")


@lru_cache(maxsize=1)
def _prices() -> dict[str, dict[str, float]]:
    path = Path(get_settings().ai_prices_file or _DEFAULT_FILE)
    try:
        return json.loads(path.read_text())["models"]
    except (OSError, ValueError, KeyError) as exc:
        logger.error("Could not read AI prices from %s (%s); costs will not be recorded", path, exc)
        return {}


def _priced_name(model: str) -> str:
    name = model.strip().lower().removeprefix("openai/")
    return _DATED_SNAPSHOT.sub("", name)


def cost_usd_micros(
    model: str,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_input_tokens: int | None = None,
) -> int | None:
    """
    List-price cost of one call in millionths of a dollar, or None when the
    model is not priced or the provider reported no token counts.

    Cached input is billed at its own rate and is part of ``input_tokens``.
    Reasoning tokens are part of ``output_tokens`` and billed as output.
    """
    price = _prices().get(_priced_name(model))
    if price is None or input_tokens is None or output_tokens is None:
        return None
    cached = min(cached_input_tokens or 0, input_tokens)
    # USD per 1M tokens is micro-dollars per token.
    cost = (
        (input_tokens - cached) * price["input"]
        + cached * price.get("cached_input", price["input"])
        + output_tokens * price["output"]
    )
    return round(cost)


@lru_cache(maxsize=1)
def _audio_prices() -> dict[str, dict[str, float]]:
    path = Path(get_settings().ai_prices_file or _DEFAULT_FILE)
    try:
        return json.loads(path.read_text()).get("audio_models", {})
    except (OSError, ValueError) as exc:
        logger.error("Could not read audio prices from %s (%s)", path, exc)
        return {}


def audio_cost_usd_micros(model: str, seconds: float | None) -> int | None:
    """List-price cost of transcribing ``seconds`` of audio, or None when unpriced."""
    price = _audio_prices().get((model or "").strip().lower())
    if price is None or seconds is None:
        return None
    # USD per hour → micro-dollars per second.
    return round(float(seconds) * price["per_hour"] * 1_000_000 / 3600)

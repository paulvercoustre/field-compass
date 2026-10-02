"""List-price cost of an AI call, stored when the call is made."""

import json

import pytest

from services import ai_pricing
from services.ai_pricing import cost_usd_micros


@pytest.fixture(autouse=True)
def _fresh_table():
    ai_pricing._prices.cache_clear()
    yield
    ai_pricing._prices.cache_clear()


def test_input_and_output_at_list_price():
    # gpt-4o-mini: 0.15 in, 0.60 out per 1M tokens = micro-dollars per token
    assert cost_usd_micros("gpt-4o-mini", 1000, 500) == 450


def test_cached_input_is_billed_at_its_own_rate():
    # gpt-5-mini: 700 x 0.25 + 300 x 0.025 + 0 output
    assert cost_usd_micros("gpt-5-mini", 1000, 0, cached_input_tokens=300) == 182


def test_dated_snapshots_and_openrouter_names():
    assert cost_usd_micros("gpt-5-mini-2025-08-07", 1000, 0) == 250
    assert cost_usd_micros("openai/gpt-4o-mini", 1000, 0) == 150


def test_unknown_model_or_missing_counts_is_not_guessed():
    assert cost_usd_micros("my-azure-deployment", 1000, 500) is None
    assert cost_usd_micros("gpt-4o-mini", None, None) is None


def test_operator_price_file(tmp_path, monkeypatch):
    prices = tmp_path / "prices.json"
    prices.write_text(json.dumps({"models": {"house-model": {"input": 1, "output": 2}}}))
    monkeypatch.setenv("AI_PRICES_FILE", str(prices))

    assert cost_usd_micros("house-model", 100, 10) == 120
    assert cost_usd_micros("gpt-4o-mini", 100, 10) is None


def test_unreadable_price_file_records_no_cost(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_PRICES_FILE", str(tmp_path / "missing.json"))
    assert cost_usd_micros("gpt-4o-mini", 100, 10) is None

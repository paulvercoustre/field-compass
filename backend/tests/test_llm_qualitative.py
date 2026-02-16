"""Tests for LLM qualitative hashing, routing, and rerun logic."""

from copy import deepcopy

from etl.hfc_engine import HFCEngine
from services.ai_service import AIService
from utils.rule_versioning import (
    generate_llm_input_hash,
    generate_llm_rules_hash,
    should_enqueue_llm_check,
)


def test_generate_llm_rules_hash_changes_with_model(test_survey_config):
    config_data = deepcopy(test_survey_config.config_data)
    config_data["quality_checks"] = {
        "flag_llm_qualitative": True,
        "llm_qualitative_fields": ["reason", "comments"],
        "llm_check_types": ["content_quality", "relevance"],
    }

    hash_a = generate_llm_rules_hash(config_data, qualitative_model="gpt-5-mini")
    hash_b = generate_llm_rules_hash(config_data, qualitative_model="gpt-5-nano")

    assert hash_a != hash_b
    assert len(hash_a) == 64


def test_generate_llm_input_hash_is_stable_with_whitespace():
    submission_a = {"reason": "  hello    world  ", "comments": "ok"}
    submission_b = {"reason": "hello world", "comments": "ok"}

    hash_a = generate_llm_input_hash(submission_a, ["reason", "comments"], "dk")
    hash_b = generate_llm_input_hash(submission_b, ["reason", "comments"], "dk")

    assert hash_a == hash_b


def test_should_enqueue_llm_check_decision_matrix():
    current_rules = "rulesA"
    current_input = "inputA"

    assert should_enqueue_llm_check(None, None, None, current_rules, current_input) == (
        True,
        "never_checked",
    )
    assert should_enqueue_llm_check(
        "success", "rulesB", "inputA", current_rules, current_input
    ) == (True, "rules_changed")
    assert should_enqueue_llm_check(
        "success", "rulesA", "inputB", current_rules, current_input
    ) == (True, "input_changed")
    assert should_enqueue_llm_check(
        "failed", "rulesA", "inputA", current_rules, current_input
    ) == (True, "retry_failed")
    assert should_enqueue_llm_check(
        "running", "rulesA", "inputA", current_rules, current_input
    ) == (False, "already_in_progress")
    assert should_enqueue_llm_check(
        "success", "rulesA", "inputA", current_rules, current_input
    ) == (False, "up_to_date")


def test_hfc_engine_needs_llm_qualitative_check(test_db, test_survey_config):
    config_data = deepcopy(test_survey_config.config_data)
    config_data["quality_checks"] = {
        "flag_llm_qualitative": True,
        "llm_qualitative_fields": ["reason"],
    }
    test_survey_config.config_data = config_data
    test_db.commit()

    engine = HFCEngine(test_db, test_survey_config)

    class DummySubmission:
        llm_check_status = "success"
        llm_rules_hash = "old_rules"
        llm_input_hash = "same_input"

    needs, reason = engine.needs_llm_qualitative_check(
        submission=DummySubmission(),
        llm_rules_hash="new_rules",
        llm_input_hash="same_input",
    )
    assert needs is True
    assert reason == "rules_changed"


def test_ai_service_task_specific_models(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5-mini")
    monkeypatch.setenv("OPENAI_RULE_GEN_MODEL", "gpt-5")
    monkeypatch.setenv("OPENAI_QUAL_CHECK_MODEL", "gpt-5-nano")

    service = AIService()
    assert service.rule_gen_model == "gpt-5"
    assert service.qual_check_model == "gpt-5-nano"


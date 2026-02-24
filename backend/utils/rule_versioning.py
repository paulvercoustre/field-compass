"""Hashing and rerun logic helpers for LLM qualitative checks."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple


def _canonical_json(value: Dict[str, Any]) -> str:
    """Return stable JSON for hashing."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _normalize_text(value: Any) -> str:
    """Normalize text consistently before hashing/sending to LLM."""
    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    # Collapse repeated whitespace and normalize casing for trivial mismatches.
    text = re.sub(r"\s+", " ", text)
    return text


def generate_llm_rules_hash(config_data: Dict[str, Any], qualitative_model: str) -> str:
    """
    Compute hash for qualitative LLM rule semantics only.

    This is intentionally separate from generic validation_rule_hash.
    """
    quality_checks = config_data.get("quality_checks", {})
    special_values = config_data.get("special_values", {})

    payload = {
        "version": "llm_rules_v1",
        "enabled": bool(quality_checks.get("flag_llm_qualitative", False)),
        "fields": sorted(quality_checks.get("llm_qualitative_fields", []) or []),
        "check_types": sorted(
            quality_checks.get(
                "llm_check_types",
                ["content_quality", "relevance", "completeness"],
            )
            or []
        ),
        "prompt_template_version": quality_checks.get("llm_prompt_template_version", "v1"),
        "schema_version": quality_checks.get("llm_response_schema_version", "v1"),
        "dk_policy_version": quality_checks.get("llm_dk_policy_version", "v1"),
        "dk_numeric": special_values.get("dk_value", -99),
        "dk_string": special_values.get("dk_string_value", "dk"),
        "qualitative_model": qualitative_model,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _resolve_field_value(submission_data: Dict[str, Any], field_name: str) -> Any:
    """
    Resolve a field value from submission data using path-aware lookup.

    Kobo stores fields with full group paths (e.g. 'group/field'), but config
    entries often use only the leaf name.  This mirrors the logic in
    HFCEngine._get_field_value so that hash computation and actual LLM
    field extraction are consistent.
    """
    if field_name in submission_data:
        return submission_data[field_name]
    for key in submission_data:
        if key.endswith(f"/{field_name}"):
            return submission_data[key]
    return None


def generate_llm_input_hash(
    submission_data: Dict[str, Any],
    llm_fields: List[str],
    dk_string_value: str,
) -> str:
    """
    Compute hash of normalized qualitative inputs for selected fields.

    A change in any monitored text field value changes this hash.
    """
    normalized: Dict[str, str] = {}
    for field in sorted(llm_fields or []):
        value = _resolve_field_value(submission_data, field)
        text = _normalize_text(value)
        if not text:
            continue
        if text.lower() == dk_string_value.lower():
            continue
        normalized[field] = text

    payload = {
        "version": "llm_input_v1",
        "fields": normalized,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def should_enqueue_llm_check(
    llm_check_status: Optional[str],
    previous_rules_hash: Optional[str],
    previous_input_hash: Optional[str],
    current_rules_hash: str,
    current_input_hash: str,
) -> Tuple[bool, str]:
    """Decide whether a qualitative check should be queued."""
    status = (llm_check_status or "").lower().strip()

    if not status or status == "skipped":
        return True, "never_checked"

    if previous_rules_hash != current_rules_hash:
        return True, "rules_changed"

    if previous_input_hash != current_input_hash:
        return True, "input_changed"

    if status == "failed":
        return True, "retry_failed"

    if status in {"pending", "running"}:
        return False, "already_in_progress"

    return False, "up_to_date"


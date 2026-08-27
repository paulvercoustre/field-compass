"""
Utilities for computing "Don't know" (DK) metrics on submissions.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EligibleDKIndex:
    """Precomputed index of question names eligible for DK counting."""

    eligible_question_names: set[str]


def _normalize_token(value: Any) -> str:
    return str(value).strip().lower()


def _get_primary_type(question_type: str) -> str:
    """Extract base Kobo type from strings like 'select_one my_list'."""
    return (question_type or "").strip().split()[0]


def _extract_list_name(question: dict[str, Any], question_type: str) -> str | None:
    list_name = question.get("list_name")
    if list_name:
        return str(list_name)

    parts = (question_type or "").strip().split()
    if len(parts) > 1:
        return parts[1]
    return None


def build_eligible_dk_question_index(config_data: dict[str, Any]) -> EligibleDKIndex:
    """
    Build an index of eligible question names for DK metrics.

    Eligible questions:
    - integer
    - text
    - select_one/select_multiple only when their choice list contains DK option
    """
    kobo_tool = (config_data or {}).get("kobo_tool", {})
    survey_sheet = kobo_tool.get("survey", []) or []
    choices_sheet = kobo_tool.get("choices", []) or []
    special_values = (config_data or {}).get("special_values", {}) or {}

    dk_value = special_values.get("dk_value")
    dk_string_value = special_values.get("dk_string_value")

    dk_tokens = set()
    if dk_string_value is not None and str(dk_string_value).strip():
        dk_tokens.add(_normalize_token(dk_string_value))
    if dk_value is not None:
        dk_tokens.add(_normalize_token(dk_value))

    # If no DK token is configured, no select question can be considered DK-eligible.
    # integer/text remain eligible because DK can still be represented as dk_value.
    choices_by_list: dict[str, set[str]] = {}
    for choice in choices_sheet:
        list_name = choice.get("list_name")
        choice_name = choice.get("name")
        if not list_name or choice_name is None:
            continue
        key = str(list_name)
        if key not in choices_by_list:
            choices_by_list[key] = set()
        choices_by_list[key].add(_normalize_token(choice_name))

    eligible_question_names: set[str] = set()
    skip_types = {"begin_group", "end_group", "begin_repeat", "end_repeat", "note"}

    for question in survey_sheet:
        q_name = question.get("name")
        q_type_raw = str(question.get("type", "") or "")
        q_type = _get_primary_type(q_type_raw)

        if not q_name or q_type in skip_types:
            continue

        if q_type in {"integer", "text"}:
            eligible_question_names.add(str(q_name))
            continue

        if q_type in {"select_one", "select_multiple"}:
            list_name = _extract_list_name(question, q_type_raw)
            if not list_name or not dk_tokens:
                continue
            list_choices = choices_by_list.get(list_name, set())
            if any(token in list_choices for token in dk_tokens):
                eligible_question_names.add(str(q_name))

    return EligibleDKIndex(eligible_question_names=eligible_question_names)


def _flatten_leaf_values(data: Any, path: str = "") -> Iterator[tuple[str, Any]]:
    """Yield (path, value) for leaf values in nested dict/list structures."""
    if isinstance(data, dict):
        for key, value in data.items():
            key_str = str(key)
            next_path = f"{path}/{key_str}" if path else key_str
            yield from _flatten_leaf_values(value, next_path)
        return

    if isinstance(data, list):
        for idx, value in enumerate(data):
            next_path = f"{path}/{idx}" if path else str(idx)
            yield from _flatten_leaf_values(value, next_path)
        return

    yield path, data


def _last_field_segment(path: str) -> str:
    """
    Return the last non-index segment of a path.

    Example:
    - household/0/age -> age
    - group/score -> score
    """
    if not path:
        return ""
    parts = [part for part in path.split("/") if part]
    for segment in reversed(parts):
        if not segment.isdigit():
            return segment
    return parts[-1] if parts else ""


def _is_present_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and value.strip() == "":
        return False
    return True


def _is_dk_value(value: Any, dk_value: Any, dk_string_value: Any) -> bool:
    if value is None:
        return False

    # Numeric DK
    if isinstance(value, int | float) and dk_value is not None and value == dk_value:
        return True

    dk_str_norm = _normalize_token(dk_string_value) if dk_string_value is not None else ""
    dk_num_norm = _normalize_token(dk_value) if dk_value is not None else ""

    # String DK (single value or select_multiple space-separated token list)
    if isinstance(value, str):
        normalized = _normalize_token(value)
        if dk_str_norm and normalized == dk_str_norm:
            return True
        if dk_num_norm and normalized == dk_num_norm:
            return True

        # select_multiple values are usually space-delimited
        tokens = [token.strip().lower() for token in value.split() if token.strip()]
        if dk_str_norm and dk_str_norm in tokens:
            return True
        if dk_num_norm and dk_num_norm in tokens:
            return True
        return False

    # Defensive handling if list values appear
    if isinstance(value, list):
        return any(_is_dk_value(item, dk_value, dk_string_value) for item in value)

    return False


def compute_dk_metrics(
    submission_data: dict[str, Any],
    eligible_index: EligibleDKIndex,
    special_values: dict[str, Any],
) -> tuple[int, int, float | None]:
    """
    Compute DK metrics for one submission.

    Returns:
      (dk_count, dk_eligible_count, dk_percentage_or_none)
    """
    eligible_names = eligible_index.eligible_question_names if eligible_index else set()
    if not eligible_names:
        return (0, 0, None)

    special_values = special_values or {}
    dk_value = special_values.get("dk_value")
    dk_string_value = special_values.get("dk_string_value")

    dk_count = 0
    dk_eligible_count = 0

    for path, value in _flatten_leaf_values(submission_data or {}):
        field_name = _last_field_segment(path)
        if not field_name or field_name not in eligible_names:
            continue
        if not _is_present_value(value):
            continue

        dk_eligible_count += 1
        if _is_dk_value(value, dk_value, dk_string_value):
            dk_count += 1

    if dk_eligible_count == 0:
        return (dk_count, dk_eligible_count, None)

    dk_percentage = (dk_count / dk_eligible_count) * 100.0
    return (dk_count, dk_eligible_count, dk_percentage)

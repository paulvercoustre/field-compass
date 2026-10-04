"""
Utilities for computing "Don't know" (DK) metrics on submissions.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EligibleDKIndex:
    """Precomputed index of question names eligible for DK counting."""

    eligible_question_names: set[str]
    # The eligible questions whose answers are space-delimited lists, and so
    # the only ones a DK code may be found inside of.
    select_multiple_names: set[str] = field(default_factory=set)


def _normalize_token(value: Any) -> str:
    return str(value).strip().lower()


def dk_string_tokens(special_values: dict[str, Any] | None) -> set[str]:
    """
    The strings this survey counts as "don't know", normalised.

    `dk_string_value` holds either one string or a list of them. A form
    assembled from more than one module, or revised mid-project, can code the
    same answer as both `dk` and `dont_know`; with only one countable, every
    occurrence of the other was silently counted as a real answer, which
    understates the DK rate rather than failing loudly.

    Both shapes are read, and a stored string is not rewritten -- a config
    written before this was a list keeps working as a list of one.
    """
    raw = (special_values or {}).get("dk_string_value")
    if raw is None:
        return set()

    values = raw if isinstance(raw, list) else [raw]
    return {_normalize_token(v) for v in values if v is not None and str(v).strip()}


# What a survey whose config never set `dk_value` has always been read as.
LEGACY_DK_CODE = -99


def _as_number(raw: Any) -> int | float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int | float):
        number = raw
    else:
        try:
            number = float(str(raw).strip())
        except ValueError:
            return None
    # `-99.0` and `-99` are one code, and Kobo sends it as the text "-99".
    return int(number) if float(number).is_integer() else number


def dk_numeric_codes(special_values: dict[str, Any] | None) -> list[int | float]:
    """
    The numbers this survey counts as "don't know", e.g. `[-99, -999]`.

    `dk_value` holds one number, a list of them, or nothing. A survey can
    have none -- its numeric questions take no DK code -- or several, when
    modules were written by different teams. An empty list or `None` means
    none; a config that never set the key keeps the -99 it always had.
    """
    sv = special_values or {}
    if "dk_value" not in sv:
        return [LEGACY_DK_CODE]
    raw = sv.get("dk_value")
    values = raw if isinstance(raw, list) else [raw]
    codes: list[int | float] = []
    for value in values:
        number = _as_number(value) if value is not None else None
        if number is not None and number not in codes:
            codes.append(number)
    return codes


def dk_codes_fingerprint(codes: list[int | float]) -> Any:
    """
    The codes as they go into a config hash.

    One code hashes as the bare number it was stored as before lists, so
    surveys that keep a single code are not all revalidated by the upgrade.
    """
    return codes[0] if len(codes) == 1 else sorted(codes)


def describe_dk_codes(codes: list[int | float]) -> str:
    """The numeric DK codes as prompt text: `-99 or -999`."""
    return " or ".join(str(code) for code in codes) if codes else "(none configured)"


def describe_dk_strings(dk_string_value: Any) -> str:
    """
    The configured DK strings as prompt text: `"dk" or "dont_know"`.

    Takes the raw `dk_string_value`, which may be one string or a list.
    """
    tokens = sorted(dk_string_tokens({"dk_string_value": dk_string_value}))
    if not tokens:
        return "(none configured)"
    return " or ".join(f'"{token}"' for token in tokens)


def is_dk_value(
    value: Any,
    dk_codes: list[int | float] | None,
    dk_tokens: set[str],
    *,
    split_multiple: bool = True,
) -> bool:
    """
    Whether one submitted value means "don't know".

    Compares against every configured string, and against each numeric code
    in `dk_codes` -- a numeric DK code often arrives as text, depending on the
    question type it was answered under.

    With `split_multiple`, a string is also read as a space-delimited
    `select_multiple` answer, so `"rice dk"` counts. Pass False when the value
    is known to be free text or a single choice: there, "call the dk office"
    is a real answer.
    """
    if value is None:
        return False

    codes = dk_codes or []

    # Numeric DK.
    if isinstance(value, int | float) and not isinstance(value, bool) and value in codes:
        return True

    tokens = set(dk_tokens)
    tokens.update(_normalize_token(code) for code in codes)
    tokens.discard("")
    if not tokens:
        return False

    if isinstance(value, str):
        if _normalize_token(value) in tokens:
            return True
        if not split_multiple:
            return False
        # `select_multiple` answers arrive as a space-delimited list, so a DK
        # coding can sit among other selected options.
        return any(part.strip().lower() in tokens for part in value.split() if part.strip())

    # Defensive handling if list values appear.
    if isinstance(value, list):
        return any(
            is_dk_value(item, codes, dk_tokens, split_multiple=split_multiple) for item in value
        )

    return False


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
    - integer, decimal
    - text
    - select_one/select_multiple only when their choice list contains DK option
    """
    kobo_tool = (config_data or {}).get("kobo_tool", {})
    survey_sheet = kobo_tool.get("survey", []) or []
    choices_sheet = kobo_tool.get("choices", []) or []
    special_values = (config_data or {}).get("special_values", {}) or {}

    dk_tokens = dk_string_tokens(special_values)
    dk_tokens.update(_normalize_token(code) for code in dk_numeric_codes(special_values))

    # If no DK token is configured, no select question can be considered DK-eligible.
    # integer/decimal/text remain eligible because DK can still be represented as a numeric code.
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
    select_multiple_names: set[str] = set()
    skip_types = {"begin_group", "end_group", "begin_repeat", "end_repeat", "note"}

    for question in survey_sheet:
        q_name = question.get("name")
        q_type_raw = str(question.get("type", "") or "")
        q_type = _get_primary_type(q_type_raw)

        if not q_name or q_type in skip_types:
            continue

        if q_type in {"integer", "decimal", "text"}:
            eligible_question_names.add(str(q_name))
            continue

        if q_type in {"select_one", "select_multiple"}:
            list_name = _extract_list_name(question, q_type_raw)
            if not list_name or not dk_tokens:
                continue
            list_choices = choices_by_list.get(list_name, set())
            if any(token in list_choices for token in dk_tokens):
                eligible_question_names.add(str(q_name))
                if q_type == "select_multiple":
                    select_multiple_names.add(str(q_name))

    return EligibleDKIndex(
        eligible_question_names=eligible_question_names,
        select_multiple_names=select_multiple_names,
    )


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
    select_multiple_names = eligible_index.select_multiple_names if eligible_index else set()
    if not eligible_names:
        return (0, 0, None)

    special_values = special_values or {}
    dk_codes = dk_numeric_codes(special_values)
    dk_tokens = dk_string_tokens(special_values)

    dk_count = 0
    dk_eligible_count = 0

    for path, value in _flatten_leaf_values(submission_data or {}):
        field_name = _last_field_segment(path)
        if not field_name or field_name not in eligible_names:
            continue
        if not _is_present_value(value):
            continue

        dk_eligible_count += 1
        if is_dk_value(
            value, dk_codes, dk_tokens, split_multiple=field_name in select_multiple_names
        ):
            dk_count += 1

    if dk_eligible_count == 0:
        return (dk_count, dk_eligible_count, None)

    dk_percentage = (dk_count / dk_eligible_count) * 100.0
    return (dk_count, dk_eligible_count, dk_percentage)

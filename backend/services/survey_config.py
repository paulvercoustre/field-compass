"""
Accessors for survey configuration.

Core identifiers are optional: a survey can be configured before its form is
final, and some forms genuinely have no enumerator question. Reading them
through this module rather than inline keeps one rule in one place --
**never substitute a value the user did not choose.**

Before this existed, `core_identifiers.get("enumerator", "enumerator_id")` was
duplicated across the HFC engine and three routers. Every copy silently
assumed a field name that may not exist in the form, which flagged every
submission as `missing_enumerator` and produced a phantom enumerator named
"Unknown" holding the entire dataset.
"""

from typing import Any

# Capability identifiers, so the client can branch on a stable string rather
# than parse prose.
CAPABILITY_ENUMERATOR_PERFORMANCE = "enumerator_performance"
CAPABILITY_ENUMERATOR_FILTER = "enumerator_filter"
CAPABILITY_DATE_CHECKS = "date_checks"

_CORE_IDENTIFIER_CAPABILITIES: dict[str, list[tuple[str, str]]] = {
    "enumerator": [
        (
            CAPABILITY_ENUMERATOR_PERFORMANCE,
            "Field team performance is grouped by enumerator.",
        ),
        (
            CAPABILITY_ENUMERATOR_FILTER,
            "Submissions cannot be filtered by enumerator.",
        ),
    ],
    "date_interview": [
        (
            CAPABILITY_DATE_CHECKS,
            "Date-range and weekend checks need the interview date.",
        ),
    ],
}


def get_core_identifier(config_data: dict[str, Any] | None, name: str) -> str | None:
    """
    Return a configured core identifier, or None when the user did not set one.

    Blank strings count as unset -- clearing the field in the UI stores `""`,
    and that has to mean the same thing as never having chosen.
    """
    core_identifiers = (config_data or {}).get("core_identifiers") or {}
    value = core_identifiers.get(name)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def get_enumerator_field(config_data: dict[str, Any] | None) -> str | None:
    """Field holding the enumerator identifier, or None when unset."""
    return get_core_identifier(config_data, "enumerator")


def unavailable_capabilities(config_data: dict[str, Any] | None) -> list[dict[str, str]]:
    """
    Features that cannot work under the current configuration, with reasons.

    Returned to clients so a view can explain itself instead of rendering an
    empty chart -- the same role the `mode` field plays for progress data.
    """
    unavailable: list[dict[str, str]] = []
    for identifier, capabilities in _CORE_IDENTIFIER_CAPABILITIES.items():
        if get_core_identifier(config_data, identifier) is not None:
            continue
        for capability, reason in capabilities:
            unavailable.append(
                {
                    "capability": capability,
                    "reason": reason,
                    "missing_setting": f"core_identifiers.{identifier}",
                }
            )
    return unavailable


# ---------------------------------------------------------------------------
# Collection targets
# ---------------------------------------------------------------------------
#
# User-facing copy says "collection targets", not "sampling frame". A sampling
# frame, methodologically, is the list of units you sample *from*; what this
# holds is the opposite end -- how many interviews you intend to *do* per group.
# One real frame file names its target column `interview_target`. The
# `sampling_frame` config key is kept as-is so nothing has to be migrated.

SAMPLING_MODE_NONE = "none"
SAMPLING_MODE_TOTAL = "total"
SAMPLING_MODE_BY_VARIABLE = "by_variable"
SAMPLING_MODE_UPLOADED = "uploaded"

SAMPLING_MODES = (
    SAMPLING_MODE_NONE,
    SAMPLING_MODE_TOTAL,
    SAMPLING_MODE_BY_VARIABLE,
    SAMPLING_MODE_UPLOADED,
)

# Modes that supply targets. Everything else can only describe what was
# collected, never what fraction of a plan it represents.
_MODES_WITH_TARGETS = frozenset(
    {SAMPLING_MODE_TOTAL, SAMPLING_MODE_BY_VARIABLE, SAMPLING_MODE_UPLOADED}
)


def _sampling_config(config_data: dict[str, Any] | None) -> dict[str, Any]:
    return (config_data or {}).get("sampling_frame") or {}


def get_sampling_cols(config_data: dict[str, Any] | None) -> list[str]:
    """Variables the survey is disaggregated by. Empty when none are declared."""
    cols = _sampling_config(config_data).get("sampling_cols") or []
    return [str(col) for col in cols if str(col).strip()]


def get_frame_data(config_data: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Rows of an uploaded targets file. Empty when nothing was uploaded."""
    return _sampling_config(config_data).get("frame_data") or []


def get_sampling_mode(config_data: dict[str, Any] | None) -> str:
    """
    How this survey expresses its collection targets.

    A stored config with no `mode` predates the field, so it is inferred rather
    than defaulted to a constant: `uploaded` when frame rows are present,
    `none` when they are not. That is exactly what those configs already do, so
    every existing survey keeps its behaviour without being migrated.

    An unrecognised mode is treated the same way. A typo must not silently
    become "no targets" for a survey that has them.
    """
    mode = _sampling_config(config_data).get("mode")
    if mode in SAMPLING_MODES:
        return str(mode)
    return SAMPLING_MODE_UPLOADED if get_frame_data(config_data) else SAMPLING_MODE_NONE


def has_targets(config_data: dict[str, Any] | None) -> bool:
    """
    Whether a percentage can honestly be computed.

    Not the same as "has sampling columns": columns say how to disaggregate,
    targets say what to divide by.
    """
    mode = get_sampling_mode(config_data)
    if mode not in _MODES_WITH_TARGETS:
        return False
    if mode == SAMPLING_MODE_TOTAL:
        return get_total_target(config_data) is not None
    if mode == SAMPLING_MODE_UPLOADED:
        return bool(get_frame_data(config_data))
    return bool(get_targets_by_value(config_data))


def get_total_target(config_data: dict[str, Any] | None) -> int | None:
    """
    The single number in `total` mode, or None when it is unset or unusable.

    Zero is rejected along with negatives and junk: a target of nothing cannot
    produce a meaningful percentage, and treating it as one is how a survey
    with no targets came to report 100% complete.
    """
    return _positive_int(_sampling_config(config_data).get("total_target"))


def _positive_int(raw: Any) -> int | None:
    """A usable target, or None.

    Zero is rejected along with negatives and junk. A target of nothing cannot
    produce a meaningful percentage, and treating it as one is how a survey
    with no targets came to report 100% complete.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def get_sampling_variable(config_data: dict[str, Any] | None) -> str | None:
    """
    The question whose choice list defines the strata, in `by_variable` mode.

    `sampling_cols` mirrors this as a single-element list, so every existing
    consumer -- progress disaggregation, the submissions filter, the quality
    breakdown -- keeps working without knowing this mode exists. This accessor
    is for the places that need the *chosen* variable rather than "whatever we
    disaggregate by", such as looking its choice list up in the form.
    """
    variable = _sampling_config(config_data).get("variable")
    if variable is None:
        return None
    text = str(variable).strip()
    return text or None


def get_targets_by_value(config_data: dict[str, Any] | None) -> dict[str, int]:
    """
    Per-choice-value targets in `by_variable` mode.

    Unusable entries are dropped rather than defaulted, so a strata table half
    filled in yields targets for the values that have one and no target for the
    rest -- instead of a fabricated zero that would divide into a percentage.
    """
    raw = _sampling_config(config_data).get("targets_by_value")
    if not isinstance(raw, dict):
        return {}

    targets: dict[str, int] = {}
    for value, target in raw.items():
        parsed = _positive_int(target)
        if parsed is not None:
            targets[str(value)] = parsed
    return targets

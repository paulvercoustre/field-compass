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

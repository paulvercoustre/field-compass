"""
How long an interview took: one rule for the duration check and every screen.

The audit log's active time when the form has one (etl/audit_processor.py
stores it on the submission as ``active_interview_time``, in minutes);
otherwise the time from the form's start question to its end question. Kobo's
own submission and upload times are never used: they say when the phone sent
the form, not how long the interview lasted.

Before this, the check fell back to start and end but Data quality and Field
team read only the audit log, so a form without one showed no duration on
Data quality and "0 min" on Field team while the check still flagged it.
"""

from datetime import datetime
from typing import Any

from forms.answers import find_answer

# Where a duration came from.
AUDIT = "audit"
START_END = "start_end"


def interview_time_fields(config_data: dict[str, Any] | None) -> tuple[str, str]:
    """The start and end questions, as the duration check has always read them."""
    core_identifiers = (config_data or {}).get("core_identifiers") or {}
    return core_identifiers.get("start_time", "start"), core_identifiers.get("end_time", "end")


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    if isinstance(value, datetime):
        return value
    raise TypeError(f"not a time: {value!r}")


def interview_minutes(
    submission_data: dict[str, Any] | None, start_field: str | None, end_field: str | None
) -> tuple[float | None, str | None]:
    """The interview's length in minutes and where it came from; ``(None, None)`` if unknown."""
    data = submission_data or {}
    active = data.get("active_interview_time")
    if active is not None:
        try:
            return float(active), AUDIT
        except (TypeError, ValueError):
            pass  # An unreadable audit time is no audit time: fall back.

    start, _ = find_answer(data, start_field)
    end, _ = find_answer(data, end_field)
    if not start or not end:
        return None, None
    try:
        minutes = (_as_datetime(end) - _as_datetime(start)).total_seconds() / 60
    except (TypeError, ValueError):
        # Unparseable, or one time with a zone and one without.
        return None, None
    return minutes, START_END

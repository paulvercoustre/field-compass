"""
Narrowing a survey's submissions by the answers they hold.

/submissions and /quality/overview filter the same way: by enumerator, and by
sampling variable, written ``district=north,south;livelihood=farming``. An
answer is found the way the checks find it (forms.answers, so a group path
matches) and compared as text. A submission with no answer to a filtered
question is left out: it did not answer ``north``, whatever else it did.

Only the survey's sampling columns can be filtered on; any other variable in
the filter is ignored, as is an enumerator filter on a survey with no
enumerator question.
"""

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Query

from database.models import SubmissionCurrent
from forms.answers import answer_value


def parse_list(text: str | None) -> list[str]:
    """``"a, b,,c"`` as ``["a", "b", "c"]``."""
    return [part.strip() for part in (text or "").split(",") if part.strip()]


def parse_sampling_filters(text: str | None) -> dict[str, list[str]]:
    """``"district=north,south;livelihood=farming"`` as a dict of value lists.

    Parts without ``=`` or without values are skipped.
    """
    filters: dict[str, list[str]] = {}
    for part in (text or "").split(";"):
        variable, sep, values = part.partition("=")
        if sep and variable.strip() and (parsed := parse_list(values)):
            filters[variable.strip()] = parsed
    return filters


def answer_text(data: dict[str, Any] | None, question: str) -> str | None:
    """The answer to ``question`` as the filters compare it: text, or None when blank."""
    answer = answer_value(data, question)
    if answer is None or (isinstance(answer, str) and not answer.strip()):
        return None
    return str(answer)


def _answered_one_of(data: dict[str, Any] | None, question: str, values: Sequence[str]) -> bool:
    answer = answer_text(data, question)
    return answer is not None and answer in values


def filter_by_answers(
    submissions: Iterable[SubmissionCurrent],
    *,
    enumerator_field: str | None,
    enumerators: Sequence[str],
    sampling_filters: dict[str, list[str]],
    sampling_cols: Sequence[str],
) -> list[SubmissionCurrent]:
    """The submissions whose answers match every filter given."""
    conditions: list[tuple[str, Sequence[str]]] = [
        (question, values)
        for question, values in sampling_filters.items()
        if question in sampling_cols
    ]
    if enumerator_field and enumerators:
        conditions.insert(0, (enumerator_field, enumerators))
    return [
        sub
        for sub in submissions
        if all(_answered_one_of(sub.submission_data, q, values) for q, values in conditions)
    ]


def _parse_day(value: str, name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid {name} format: {value}. Use YYYY-MM-DD."
        ) from None


def within_dates(
    query: Query[SubmissionCurrent], start_date: str | None, end_date: str | None
) -> Query[SubmissionCurrent]:
    """Submissions sent from the start date through the whole of the end date (YYYY-MM-DD)."""
    if start_date:
        query = query.filter(
            SubmissionCurrent._submission_time >= _parse_day(start_date, "start_date")
        )
    if end_date:
        end = _parse_day(end_date, "end_date").replace(hour=23, minute=59, second=59)
        query = query.filter(SubmissionCurrent._submission_time <= end)
    return query

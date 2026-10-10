"""
The quality dashboard's numbers, from a list of submissions.

Pure arithmetic: which submissions to include is the caller's business (see
routers/quality.py and services/submission_filters.py). The views it feeds
are in docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

from database.models import SubmissionCurrent
from schemas import CheckRow, QualityOverviewResponse, TemporalDataPoint, TopEnumerator
from services.metrics import counts, summarise
from services.review_queue import NEEDS_REVIEW, review_state
from services.submission_filters import answer_text
from services.survey_config import built_in_check_of, built_in_checks, get_enumerator_field

TREND_DAYS = 14


def _top_enumerator(flagged_by: Counter[str], submissions_by: Counter[str]) -> TopEnumerator | None:
    """The enumerator with the most flagged; on a tie, the one with fewer submissions."""
    if not flagged_by:
        return None
    enum_id = min(flagged_by, key=lambda e: (-flagged_by[e], submissions_by[e], e))
    return TopEnumerator(
        id=enum_id, flagged=flagged_by[enum_id], submissions=submissions_by[enum_id]
    )


def by_check(
    submissions: list[SubmissionCurrent], config_data: dict[str, Any] | None
) -> list[CheckRow]:
    """
    Each check that flagged something, most flagged first, with how many of
    those still need review, the last 14 days and the enumerator it flagged
    most. Then the built-in checks that are on and flagged nothing, and those
    that are off, so a quiet check is never mistaken for a clean one.
    """
    enumerator_field = get_enumerator_field(config_data)
    times = [sub._submission_time for sub in submissions if sub._submission_time is not None]
    last_day = max(times).date() if times else None
    trend_days: list[date] = (
        [last_day - timedelta(days=n) for n in reversed(range(TREND_DAYS))] if last_day else []
    )

    issues_of: Counter[str] = Counter()
    flagged_of: Counter[str] = Counter()
    waiting_of: Counter[str] = Counter()
    flagged_by: dict[str, Counter[str]] = defaultdict(Counter)
    days_of: dict[str, Counter[date]] = defaultdict(Counter)
    submissions_by: Counter[str] = Counter()
    for sub in submissions:
        enum_id = answer_text(sub.submission_data, enumerator_field) if enumerator_field else None
        if enum_id is not None:
            submissions_by[enum_id] += 1
        issues = [issue.get("check", "unknown") for issue in sub.data_quality_issues or []]
        issues_of.update(issues)
        waiting = review_state(sub) == NEEDS_REVIEW
        for check in set(issues):
            flagged_of[check] += 1
            waiting_of[check] += 1 if waiting else 0
            if enum_id is not None:
                flagged_by[check][enum_id] += 1
            if sub._submission_time is not None:
                days_of[check][sub._submission_time.date()] += 1

    settings = dict(built_in_checks(config_data))
    flagged_rows = []
    for check, flagged in flagged_of.items():
        group = built_in_check_of(check)
        flagged_rows.append(
            CheckRow(
                check=check,
                on=settings[group] if group else None,
                flagged=flagged,
                issues=issues_of[check],
                needs_review=waiting_of[check],
                last_14_days=[days_of[check][day] for day in trend_days],
                top_enumerator=_top_enumerator(flagged_by[check], submissions_by),
            )
        )
    flagged_rows.sort(key=lambda r: (-r.flagged, r.check))

    flagging = {built_in_check_of(row.check) for row in flagged_rows}
    quiet = [
        CheckRow(check=key, on=on, last_14_days=[0] * len(trend_days) if on else [])
        for key, on in settings.items()
        if key not in flagging
    ]
    quiet.sort(key=lambda r: not r.on)
    return flagged_rows + quiet


def quality_overview(
    submissions: list[SubmissionCurrent], config_data: dict[str, Any] | None
) -> QualityOverviewResponse:
    """The named counts and measurements, each check, and the days of collection."""
    waiting = [
        sub._submission_time
        for sub in submissions
        if sub._submission_time is not None and review_state(sub) == NEEDS_REVIEW
    ]

    # By the day each submission was collected, as it stands now.
    by_date: dict[str, list[SubmissionCurrent]] = defaultdict(list)
    for sub in submissions:
        by_date[sub._submission_time.strftime("%Y-%m-%d")].append(sub)
    sorted_dates = sorted(by_date)

    checks = built_in_checks(config_data)
    return QualityOverviewResponse(
        summary=summarise(submissions, config_data),
        oldest_needs_review=min(waiting).isoformat() if waiting else None,
        by_check=by_check(submissions, config_data),
        temporal_data=[TemporalDataPoint(date=day, **counts(by_date[day])) for day in sorted_dates],
        date_range={
            "start": sorted_dates[0] if sorted_dates else "",
            "end": sorted_dates[-1] if sorted_dates else "",
        },
        checks_on=[key for key, on in checks if on],
        checks_off=[key for key, on in checks if not on],
    )

"""
The counts and measurements the data pages share: one definition each.

Data quality, Field team, Progress and the pull summary all read these, so a
number means the same thing on every screen. The words the screens show and
their definitions are in frontend/utils/glossary.ts, and the reasoning in
docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md.

- Flagged: at least one issue, whatever a reviewer decided.
- Needs review, On hold, Clean and Reviewed: the Submissions tabs' own rule
  (services/review_queue.review_state). Reviewed splits into Approved and Not
  approved by Kobo's decision.
- Duration: the median of etl/duration.interview_minutes, the rule the
  duration check uses.
- Don't-know rate: pooled from the counts the checks store on each submission
  (dk_count of dk_eligible_count): don't-know answers out of the answers to
  questions that allow one, never out of every field.
- Issues per submission: issues ÷ submissions, every submission counting once.
- Per check: how many submissions each check flagged. By day: the counts
  for each day of collection, so a trend can show whether things improve.

Pure functions over submissions already loaded; which ones to include is the
caller's business.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime
from statistics import median, quantiles
from typing import Any

from database.models import SubmissionCurrent
from etl.duration import START_END, interview_minutes, interview_time_fields
from schemas import DayPoint, SubmissionSummary
from services.review_queue import REVIEWED, review_state

COUNT_KEYS = (
    "submissions",
    "flagged",
    "issues",
    "needs_review",
    "on_hold",
    "clean",
    "reviewed",
    "approved",
    "not_approved",
)


def is_approved(sub: SubmissionCurrent) -> bool:
    """Marked Approved in Kobo."""
    return (sub.kobo_validation_status or "").strip().lower() == "approved"


def is_not_approved(sub: SubmissionCurrent) -> bool:
    """Decided in Kobo, and not Approved or On hold: Kobo's Not Approved."""
    return review_state(sub) == REVIEWED and not is_approved(sub)


def counts(submissions: Iterable[SubmissionCurrent]) -> dict[str, int]:
    """The named counts, keyed as SubmissionSummary and TemporalDataPoint name them."""
    tally: dict[str, int] = dict.fromkeys(COUNT_KEYS, 0)
    for sub in submissions:
        issues = len(sub.data_quality_issues or [])
        tally["submissions"] += 1
        tally["issues"] += issues
        tally["flagged"] += 1 if issues else 0
        state = review_state(sub)
        if state == REVIEWED:
            tally["reviewed"] += 1
            tally["approved" if is_approved(sub) else "not_approved"] += 1
        else:
            # needs_review, on_hold or clean: the keys are the states' own names.
            tally[state] += 1
    return tally


def durations(
    submissions: Iterable[SubmissionCurrent], config_data: dict[str, Any] | None
) -> tuple[list[float], int]:
    """Each measurable interview's minutes, and how many came from start and end."""
    start_field, end_field = interview_time_fields(config_data)
    minutes_list: list[float] = []
    from_start_end = 0
    for sub in submissions:
        minutes, source = interview_minutes(sub.submission_data, start_field, end_field)
        if minutes is not None:
            minutes_list.append(minutes)
            if source == START_END:
                from_start_end += 1
    return minutes_list, from_start_end


def _quartiles(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    if len(values) == 1:
        return values[0], values[0]
    low, _, high = quantiles(values, n=4, method="inclusive")
    return low, high


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def summarise(
    submissions: Sequence[SubmissionCurrent], config_data: dict[str, Any] | None
) -> SubmissionSummary:
    """The named counts and the measurements of these submissions."""
    tally = counts(submissions)
    minutes, from_start_end = durations(submissions, config_data)
    p25, p75 = _quartiles(minutes)

    dk_answers = dk_eligible = 0
    checks: Counter[str] = Counter()
    days: dict[str, dict[str, int]] = defaultdict(
        lambda: dict.fromkeys(("submissions", "flagged", "issues"), 0)
    )
    times: list[datetime] = []
    for sub in submissions:
        if sub.dk_eligible_count:
            dk_answers += sub.dk_count or 0
            dk_eligible += sub.dk_eligible_count
        issues = sub.data_quality_issues or []
        checks.update({issue.get("check", "unknown") for issue in issues})
        if sub._submission_time is not None:
            times.append(sub._submission_time)
            day = days[sub._submission_time.date().isoformat()]
            day["submissions"] += 1
            day["flagged"] += 1 if issues else 0
            day["issues"] += len(issues)

    total = tally["submissions"]
    return SubmissionSummary(
        **tally,
        issues_per_submission=round(tally["issues"] / total, 2) if total else None,
        duration_minutes=_round(median(minutes)) if minutes else None,
        duration_measured=len(minutes),
        duration_from_start_end=from_start_end,
        duration_p25=_round(p25),
        duration_p75=_round(p75),
        dk_rate=round(dk_answers / dk_eligible * 100, 1) if dk_eligible else None,
        checks=dict(checks.most_common()),
        first_submission=min(times).isoformat() if times else None,
        last_submission=max(times).isoformat() if times else None,
        daily=[DayPoint(day=day, **days[day]) for day in sorted(days)],
    )

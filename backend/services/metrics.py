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

Pure functions over submissions already loaded; which ones to include is the
caller's business.
"""

from collections.abc import Iterable, Sequence
from statistics import median
from typing import Any

from database.models import SubmissionCurrent
from etl.duration import START_END, interview_minutes, interview_time_fields
from schemas import SubmissionSummary
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


def summarise(
    submissions: Sequence[SubmissionCurrent], config_data: dict[str, Any] | None
) -> SubmissionSummary:
    """The named counts and the measurements of these submissions."""
    tally = counts(submissions)
    start_field, end_field = interview_time_fields(config_data)

    durations: list[float] = []
    from_start_end = 0
    dk_answers = dk_eligible = 0
    for sub in submissions:
        minutes, source = interview_minutes(sub.submission_data, start_field, end_field)
        if minutes is not None:
            durations.append(minutes)
            if source == START_END:
                from_start_end += 1
        if sub.dk_eligible_count:
            dk_answers += sub.dk_count or 0
            dk_eligible += sub.dk_eligible_count

    total = tally["submissions"]
    return SubmissionSummary(
        **tally,
        issues_per_submission=round(tally["issues"] / total, 2) if total else None,
        duration_minutes=round(median(durations), 1) if durations else None,
        duration_measured=len(durations),
        duration_from_start_end=from_start_end,
        dk_rate=round(dk_answers / dk_eligible * 100, 1) if dk_eligible else None,
    )

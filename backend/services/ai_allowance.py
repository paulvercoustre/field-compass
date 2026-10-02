"""
The free AI allowance: how much a survey may spend on the operator's key.

Surveys without their own provider run AI checks on the operator's key, up
to a monthly number of checked submissions per survey; AI rule writing on
that key is limited per user per day. Both are counted from ``ai_usage``, so
the limit is what was actually spent, not an estimate. A survey with its own
provider has no Field Compass limit -- its provider's apply.

Calls that never reached the provider (a timeout, a rejected key) cost
nothing and are not counted. Checks already queued are reserved against the
allowance, so one large pull cannot overshoot it.

See docs/specs/ai-provider-overhaul.md, section 10.
"""

from __future__ import annotations

import os
from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import AIUsage, SubmissionCurrent
from services.ai_usage import QUALITATIVE_CHECK, RULE_GENERATION, RULE_SUGGESTION

NOT_RUN_ALLOWANCE = "not_run_allowance"

# Outcomes that cost credit: the provider produced output. A bad_response
# was still generated and billed.
_SPENT = ("ok", "bad_response")


def _int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def checks_per_survey_month() -> int:
    return _int_env("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", 200)


def rule_requests_per_user_day() -> int:
    return _int_env("AI_ALLOWANCE_RULE_REQUESTS_PER_USER_DAY", 30)


def allowance_enabled() -> bool:
    """Off: AI features need the survey owner's own provider."""
    if os.getenv("AI_ALLOWANCE_ENABLED", "true").lower() in {"0", "false", "no"}:
        return False
    return bool(os.getenv("OPENAI_API_KEY"))


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month_start(now: datetime | None = None) -> datetime:
    start = month_start(now)
    return (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )


def _day_start(now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _spent_submissions(db: Session, survey_id: UUID, now: datetime | None = None):
    """Submissions with a check this month that cost credit on the operator's key."""
    return (
        db.query(AIUsage.submission_id)
        .filter(
            AIUsage.survey_id == survey_id,
            AIUsage.feature == QUALITATIVE_CHECK,
            # Checks always name their submission; without this a NULL would
            # make the NOT IN below match nothing at all.
            AIUsage.submission_id.isnot(None),
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_SPENT),
            AIUsage.created_at >= month_start(now),
        )
        .distinct()
    )


def checks_used(db: Session, survey_id: UUID, now: datetime | None = None) -> int:
    """
    Submissions this survey had AI-checked on the operator's key this month.

    Counted per submission, not per call: a check retried after a billed but
    unusable reply is still one checked submission.
    """
    return _spent_submissions(db, survey_id, now).count()


def checks_in_flight(db: Session, survey_id: UUID, now: datetime | None = None) -> int:
    """
    Checks queued or running that are not already counted as used.

    A submission retrying after a billed reply is both pending and spent;
    it holds one allowance slot, not two.
    """
    return (
        db.query(func.count(SubmissionCurrent._id))
        .filter(
            SubmissionCurrent.survey_id == survey_id,
            SubmissionCurrent.llm_check_status.in_(("pending", "running")),
            ~SubmissionCurrent._id.in_(_spent_submissions(db, survey_id, now)),
        )
        .scalar()
    )


def checks_remaining(db: Session, survey_id: UUID, now: datetime | None = None) -> int:
    """How many more checks this survey may queue on the operator's key this month."""
    if not allowance_enabled():
        return 0
    used = checks_used(db, survey_id, now) + checks_in_flight(db, survey_id, now)
    return max(0, checks_per_survey_month() - used)


def rule_requests_remaining(db: Session, user_id: UUID, now: datetime | None = None) -> int:
    """How many more AI rule requests this user may make on the operator's key today."""
    if not allowance_enabled():
        return 0
    used = (
        db.query(func.count(AIUsage.usage_id))
        .filter(
            AIUsage.user_id == user_id,
            AIUsage.feature.in_((RULE_GENERATION, RULE_SUGGESTION)),
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_SPENT),
            AIUsage.created_at >= _day_start(now),
        )
        .scalar()
    )
    return max(0, rule_requests_per_user_day() - used)


def not_run_message(now: datetime | None = None) -> str:
    """Stored as llm_last_error for a check the allowance did not cover."""
    month = month_start(now).strftime("%B")
    return (
        f"allowance: This survey has used its free AI checks for {month}. They resume next "
        "month, or straight away with your own AI provider."
    )

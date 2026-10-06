"""
Included AI usage: how much an account may spend on the operator's key.

The included usage belongs to the account that owns the surveys, and is shared
by all of them: AI reviews (counted per checked submission), translations (per
translated answer) and, in services/transcription_allowance.py, minutes of
transcription, each with its own monthly limit. AI rule writing is limited per
user who asks. All are counted from ``ai_usage``, so the limit is what was
actually spent, not an estimate. A survey on its owner's own key has no Field
Compass limit -- its provider's apply -- and spends none of the included usage.

A usage row counts against the account it was billed to (``billed_user_id``,
the survey's owner when the call was made, so a survey that changes hands
takes none of its history along). Rows from before that was recorded count
against whoever owns the survey now. A survey with no owner has an allowance
of its own.

Calls that never reached the provider (a timeout, a rejected key) cost
nothing and are not counted. Work already queued is reserved against the
allowance, so one large pull cannot overshoot it.

See docs/specs/ai-provider-overhaul.md, section 10.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from database.models import ITEM_OPEN, AIUsage, AnswerTranslation, SubmissionCurrent, SurveyConfig
from services.ai_providers import survey_connection, translation_connection
from services.ai_usage import QUALITATIVE_CHECK, RULE_GENERATION, RULE_SUGGESTION, TRANSLATION
from settings import get_settings

NOT_RUN_ALLOWANCE = "not_run_allowance"

# Outcomes that cost credit: the provider produced output. A bad_response
# was still generated and billed.
_SPENT = ("ok", "bad_response")


@dataclass(frozen=True)
class Account:
    """Whose included usage a survey spends: its owner's, or its own when it has none."""

    user_id: UUID | None
    survey_id: UUID | None = None

    @classmethod
    def of(cls, survey: SurveyConfig) -> Account:
        if survey.user_id is not None:
            return cls(user_id=survey.user_id)
        return cls(user_id=None, survey_id=survey.survey_id)

    @property
    def key(self) -> str:
        """Names the account in a lock."""
        return f"user:{self.user_id}" if self.user_id else f"survey:{self.survey_id}"

    def usage(self):
        """The ``ai_usage`` rows that count against this account."""
        if self.user_id is None:
            return and_(AIUsage.survey_id == self.survey_id, AIUsage.billed_user_id.is_(None))
        owned = select(SurveyConfig.survey_id).where(SurveyConfig.user_id == self.user_id)
        return or_(
            AIUsage.billed_user_id == self.user_id,
            and_(AIUsage.billed_user_id.is_(None), AIUsage.survey_id.in_(owned)),
        )

    def surveys(self, db: Session) -> list[SurveyConfig]:
        if self.user_id is None:
            survey = db.get(SurveyConfig, self.survey_id)
            return [survey] if survey else []
        return db.query(SurveyConfig).filter(SurveyConfig.user_id == self.user_id).all()


def checks_per_month() -> int:
    return get_settings().ai_allowance_checks_per_user_month


def translations_per_month() -> int:
    return get_settings().ai_allowance_translations_per_user_month


def rule_requests_per_user_month() -> int:
    return get_settings().ai_allowance_rule_requests_per_user_month


def allowance_enabled() -> bool:
    """Off: AI features need the survey owner's own provider."""
    return get_settings().allowance_enabled


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


# --- AI reviews -----------------------------------------------------------------


def _spent_check(now: datetime | None):
    """An operator-key review this month that cost credit."""
    return and_(
        AIUsage.feature == QUALITATIVE_CHECK,
        # Checks always name their submission; without this a NULL would
        # make the NOT IN below match nothing at all.
        AIUsage.submission_id.isnot(None),
        AIUsage.connection_id.is_(None),
        AIUsage.outcome.in_(_SPENT),
        AIUsage.created_at >= month_start(now),
    )


def counted_submission_ids(db: Session, survey_id: UUID, now: datetime | None = None) -> set[int]:
    """This survey's submissions already counted this month: checking one again is free."""
    rows = (
        db.query(AIUsage.submission_id)
        .filter(AIUsage.survey_id == survey_id, _spent_check(now))
        .distinct()
    )
    return {submission_id for (submission_id,) in rows}


def checks_used(db: Session, account: Account, now: datetime | None = None) -> int:
    """
    Submissions the account had AI-checked on the operator's key this month.

    Counted per submission, not per call: a check retried after a billed but
    unusable reply is still one checked submission.
    """
    pairs = (
        db.query(AIUsage.survey_id, AIUsage.submission_id)
        .filter(account.usage(), _spent_check(now))
        .distinct()
        .subquery()
    )
    return db.query(func.count()).select_from(pairs).scalar() or 0


def checks_in_flight(db: Session, account: Account, now: datetime | None = None) -> int:
    """
    Checks queued or running, on the account's surveys that use the operator's
    key, that are not already counted as used.

    A submission retrying after a billed reply is both pending and spent; it
    holds one allowance slot, not two.
    """
    survey_ids = [s.survey_id for s in account.surveys(db) if survey_connection(db, s) is None]
    if not survey_ids:
        return 0
    already_spent = exists().where(
        AIUsage.survey_id == SubmissionCurrent.survey_id,
        AIUsage.submission_id == SubmissionCurrent._id,
        _spent_check(now),
    )
    return (
        db.query(func.count(SubmissionCurrent._id))
        .filter(
            SubmissionCurrent.survey_id.in_(survey_ids),
            SubmissionCurrent.llm_check_status.in_(ITEM_OPEN),
            ~already_spent,
        )
        .scalar()
    ) or 0


def checks_remaining(db: Session, account: Account, now: datetime | None = None) -> int:
    """How many more checks the account may queue on the operator's key this month."""
    if not allowance_enabled():
        return 0
    used = checks_used(db, account, now) + checks_in_flight(db, account, now)
    return max(0, checks_per_month() - used)


def rule_requests_remaining(db: Session, user_id: UUID, now: datetime | None = None) -> int:
    """How many more AI rule requests this user may make on the operator's key this month."""
    if not allowance_enabled():
        return 0
    used = (
        db.query(func.count(AIUsage.usage_id))
        .filter(
            AIUsage.user_id == user_id,
            AIUsage.feature.in_((RULE_GENERATION, RULE_SUGGESTION)),
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_SPENT),
            AIUsage.created_at >= month_start(now),
        )
        .scalar()
    )
    return max(0, rule_requests_per_user_month() - used)


def not_run_message(now: datetime | None = None) -> str:
    """Stored as llm_last_error for a check the allowance did not cover."""
    month = month_start(now).strftime("%B")
    return (
        f"allowance: The included AI reviews for {month}, shared by all of the owner's surveys, "
        "are used up. They resume next month, or straight away with your own AI key."
    )


# --- Translations ---------------------------------------------------------------


def translations_used(db: Session, account: Account, now: datetime | None = None) -> int:
    """
    Answers the account had translated on the operator's key this month.

    Counted per call that cost credit: one answer, one translation (a retry
    after a billed but unusable reply counts again: it was billed again).
    """
    return (
        db.query(func.count(AIUsage.usage_id))
        .filter(
            account.usage(),
            AIUsage.feature == TRANSLATION,
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_SPENT),
            AIUsage.created_at >= month_start(now),
        )
        .scalar()
    ) or 0


def translations_in_flight(db: Session, account: Account) -> int:
    """Translations queued or running on the operator's key, each holding one slot."""
    survey_ids = [s.survey_id for s in account.surveys(db) if translation_connection(db, s) is None]
    if not survey_ids:
        return 0
    return (
        db.query(func.count(AnswerTranslation.translation_id))
        .filter(
            AnswerTranslation.survey_id.in_(survey_ids),
            AnswerTranslation.status.in_(ITEM_OPEN),
        )
        .scalar()
    ) or 0


def translations_remaining(db: Session, account: Account, now: datetime | None = None) -> int:
    """How many more answers the account may have translated on the operator's key this month."""
    if not allowance_enabled():
        return 0
    used = translations_used(db, account, now) + translations_in_flight(db, account)
    return max(0, translations_per_month() - used)


def translation_not_run_message(now: datetime | None = None) -> str:
    """Stored as last_error for a translation the allowance did not cover."""
    month = month_start(now).strftime("%B")
    return (
        f"allowance: The included translations for {month}, shared by all of the owner's "
        "surveys, are used up. They resume next month, or straight away with your own AI key "
        "for translation."
    )

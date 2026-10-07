"""
Included transcription usage: minutes of audio per account per month, shared
by all the surveys the account owns (see services/ai_allowance.py for whose
usage counts where).

Counted from ``ai_usage`` rows with ``feature = "transcription"``. A recording's
length is only known once it is downloaded, so the worker reserves its seconds
just before the call -- under a per-account lock, so concurrent transcriptions,
on one survey or several, cannot overshoot -- and settles the row once
ElevenLabs answers. A failed call costs nothing and is not counted.

See docs/specs/audio-transcription.md, section 4.6.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database.models import AIUsage, SurveyConfig
from services.ai_allowance import Account, month_start
from services.ai_pricing import audio_cost_usd_micros
from services.ai_usage import TRANSCRIPTION
from settings import get_settings

RESERVED = "reserved"
# Outcomes that count against the allowance: billed, or about to be.
_COUNTED = ("ok", RESERVED)
# A reservation this old belongs to a worker that died mid-call.
STALE_RESERVATION = timedelta(hours=1)


def minutes_per_month() -> int:
    return get_settings().transcription_allowance_minutes_per_user_month


def max_recording_seconds() -> int:
    return get_settings().transcription_max_seconds


def seconds_used(db: Session, account: Account, now: datetime | None = None) -> float:
    """Seconds the account transcribed (or reserved) on the operator's key this month."""
    value = (
        db.query(func.coalesce(func.sum(AIUsage.audio_seconds), 0))
        .filter(
            account.usage(),
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_COUNTED),
            AIUsage.created_at >= month_start(now),
        )
        .scalar()
    )
    return float(value or 0)


def seconds_remaining(db: Session, account: Account, now: datetime | None = None) -> float:
    return max(0.0, minutes_per_month() * 60 - seconds_used(db, account, now))


def _lock(db: Session, account: Account) -> None:
    """Serialise reservations for one account until the transaction ends."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"transcription-allowance:{account.key}"},
        )


def reserve(
    db: Session,
    survey: SurveyConfig,
    seconds: float,
    *,
    model: str,
    submission_id: int | None,
    user_id: UUID | None = None,
) -> AIUsage | None:
    """
    Reserve ``seconds`` of the survey owner's allowance for this month, or None
    when it would be exceeded. Commits either way (which releases the lock).
    """
    account = Account.of(survey)
    _lock(db, account)
    if seconds_used(db, account) + seconds > minutes_per_month() * 60:
        db.commit()
        return None
    row = AIUsage(
        survey_id=survey.survey_id,
        feature=TRANSCRIPTION,
        submission_id=submission_id,
        model=model,
        outcome=RESERVED,
        audio_seconds=round(seconds, 2),
        cost_usd_micros=audio_cost_usd_micros(model, seconds),
        user_id=user_id,
        billed_user_id=survey.user_id,
    )
    db.add(row)
    db.commit()
    return row


def settle(db: Session, row: AIUsage | None, outcome: str, seconds: float | None = None) -> None:
    """Record how a reserved call ended; a success takes ElevenLabs' own length."""
    if row is None:
        return
    row.outcome = outcome
    if outcome == "ok" and seconds is not None:
        row.audio_seconds = Decimal(str(round(seconds, 2)))
        row.cost_usd_micros = audio_cost_usd_micros(row.model, seconds)
    db.commit()


def release_stale_reservations(db: Session, now: datetime | None = None) -> int:
    """Reservations left by a worker that died: the call's outcome is unknown, count nothing."""
    now = now or datetime.utcnow()
    count = (
        db.query(AIUsage)
        .filter(
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.outcome == RESERVED,
            AIUsage.created_at < now - STALE_RESERVATION,
        )
        .update({AIUsage.outcome: "timeout"}, synchronize_session=False)
    )
    db.commit()
    return count


def not_run_message(now: datetime | None = None) -> str:
    month = month_start(now).strftime("%B")
    return (
        f"allowance: The {minutes_per_month()} included transcription minutes for {month}, "
        "shared by all of the owner's surveys, are used up. It resumes next month, or straight "
        "away with your own ElevenLabs key."
    )


def seconds_on_survey(db: Session, survey_id: UUID, now: datetime | None = None) -> float:
    """One survey's share of the included minutes this month."""
    value = (
        db.query(func.coalesce(func.sum(AIUsage.audio_seconds), 0))
        .filter(
            AIUsage.survey_id == survey_id,
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.connection_id.is_(None),
            AIUsage.outcome.in_(_COUNTED),
            AIUsage.created_at >= month_start(now),
        )
        .scalar()
    )
    return float(value or 0)


def seconds_on_own_key(db: Session, survey_id: UUID, now: datetime | None = None) -> float:
    """Seconds transcribed this month on the survey owner's own keys."""
    value = (
        db.query(func.coalesce(func.sum(AIUsage.audio_seconds), 0))
        .filter(
            AIUsage.survey_id == survey_id,
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.connection_id.isnot(None),
            AIUsage.outcome == "ok",
            AIUsage.created_at >= month_start(now),
        )
        .scalar()
    )
    return float(value or 0)


def record_own_key_call(
    db: Session,
    survey_id: UUID,
    *,
    connection_id: UUID,
    model: str,
    submission_id: int | None,
    billed_user_id: UUID | None,
    outcome: str,
    seconds: float | None,
) -> None:
    """A transcription on the owner's own key: recorded, never limited here."""
    db.add(
        AIUsage(
            survey_id=survey_id,
            feature=TRANSCRIPTION,
            submission_id=submission_id,
            model=model,
            outcome=outcome,
            audio_seconds=round(seconds, 2) if seconds is not None else None,
            cost_usd_micros=audio_cost_usd_micros(model, seconds) if outcome == "ok" else None,
            connection_id=connection_id,
            billed_user_id=billed_user_id,
        )
    )
    db.commit()

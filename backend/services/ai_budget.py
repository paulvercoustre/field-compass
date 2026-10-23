"""
Field Compass's monthly AI budget: a ceiling on what the whole service spends
on its own keys (OpenAI and ElevenLabs) in a calendar month, all accounts
together.

The per-account allowances (services/ai_allowance.py, transcription_allowance.py)
limit what one account uses; this limits the total, so a launch spike or
accounts made to farm the allowance can't run up an open-ended bill. With
AI_MONTHLY_BUDGET_USD set, once this month's spend reaches it the included
usage pauses for everyone until the 1st: reviews, translations and
transcriptions are held as "not run" and run on the first pull after, and AI
rule requests are refused. Surveys on their own keys are not affected.

Spend is the estimate stored on each ``ai_usage`` row at list price
(services/ai_pricing.py), on the operator's keys only. A call with no price
(a model missing from the price table) counts at the table's highest price,
so a new model never quietly stops the count; the admin page and the alerts
name it. Work already queued when the budget is reached still runs: the
providers' own limits are the hard stop.

USAGE_ADMIN_EMAILS get an email at 80% and at 100%, once each a month
(``send_alerts``, on Celery beat).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from database.models import AIUsage, AppEvent
from services import app_events
from services.ai_allowance import month_start, next_month_start
from services.ai_pricing import highest_audio_cost_usd_micros, highest_cost_usd_micros
from services.ai_usage import TRANSCRIPTION
from settings import get_settings

logger = logging.getLogger(__name__)

# The shares of the budget that email the usage admins, once each a month.
ALERT_SHARES = (0.8, 1.0)

# Outcomes that cost money: the provider produced output (a bad_response was
# still billed), or audio about to be sent (a transcription's reservation).
_BILLED = ("ok", "bad_response")
_RESERVED = "reserved"


@dataclass(frozen=True)
class Unpriced:
    """Calls this month on a model the price table doesn't list."""

    model: str
    calls: int


@dataclass(frozen=True)
class Budget:
    """This month's spend on Field Compass's keys, against the budget."""

    month: datetime
    resumes_at: datetime
    spent_micros: int
    limit_micros: int | None
    unpriced: tuple[Unpriced, ...] = ()

    @property
    def share(self) -> float | None:
        return self.spent_micros / self.limit_micros if self.limit_micros else None

    @property
    def paused(self) -> bool:
        return self.limit_micros is not None and self.spent_micros >= self.limit_micros


def limit_micros() -> int | None:
    budget = get_settings().ai_monthly_budget_usd
    return round(budget * 1_000_000) if budget else None


def _this_month(now: datetime | None):
    """Calls on the operator's keys this month that cost, or will cost, money."""
    return and_(
        AIUsage.connection_id.is_(None),
        AIUsage.created_at >= month_start(now),
        or_(
            AIUsage.outcome.in_(_BILLED),
            and_(AIUsage.feature == TRANSCRIPTION, AIUsage.outcome == _RESERVED),
        ),
    )


def current(db: Session, now: datetime | None = None) -> Budget:
    """What Field Compass's keys have spent this month, unpriced calls at the highest price."""
    priced = (
        db.query(func.coalesce(func.sum(AIUsage.cost_usd_micros), 0))
        .filter(_this_month(now), AIUsage.cost_usd_micros.isnot(None))
        .scalar()
    )
    rows = (
        db.query(
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.model,
            func.count(AIUsage.usage_id),
            func.sum(AIUsage.input_tokens),
            func.sum(AIUsage.output_tokens),
            func.sum(AIUsage.audio_seconds),
        )
        .filter(_this_month(now), AIUsage.cost_usd_micros.is_(None))
        .group_by(AIUsage.feature == TRANSCRIPTION, AIUsage.model)
        .all()
    )
    fallback = 0
    unpriced: dict[str, int] = {}
    for audio, model, calls, input_tokens, output_tokens, seconds in rows:
        fallback += (
            highest_audio_cost_usd_micros(seconds)
            if audio
            else highest_cost_usd_micros(input_tokens, output_tokens)
        )
        unpriced[model or "unknown"] = unpriced.get(model or "unknown", 0) + calls
    return Budget(
        month=month_start(now),
        resumes_at=next_month_start(now),
        spent_micros=int(priced or 0) + fallback,
        limit_micros=limit_micros(),
        unpriced=tuple(Unpriced(model, calls) for model, calls in sorted(unpriced.items())),
    )


def paused(db: Session, now: datetime | None = None) -> bool:
    """Whether this month's budget is spent: the included usage waits for the 1st."""
    return limit_micros() is not None and current(db, now).paused


def _resume_day(now: datetime | None) -> str:
    resumes = next_month_start(now)
    return f"{resumes.day} {resumes:%B}"


def paused_detail(now: datetime | None = None) -> str:
    """Shown to someone who asks for AI on Field Compass's keys while they are paused."""
    return (
        f"Field Compass's included AI is paused until {_resume_day(now)}. It's back then, "
        "or straight away with your own AI provider in Account Settings."
    )


def paused_message(now: datetime | None = None, own_key: str = "your own AI key") -> str:
    """Stored as the error of work held back while the budget is spent."""
    return (
        f"allowance: Field Compass's included AI is paused until {_resume_day(now)}. "
        f"It runs then, or straight away with {own_key}."
    )


# --- Alerts to the usage admins ----------------------------------------------------


def _alerted(db: Session, budget: Budget, share: float) -> bool:
    month = f"{budget.month:%Y-%m}"
    events = db.query(AppEvent.details).filter(
        AppEvent.kind == app_events.AI_BUDGET_ALERT, AppEvent.created_at >= budget.month
    )
    return any(
        (details or {}).get("month") == month and (details or {}).get("share") == share
        for (details,) in events
    )


def send_alerts(db: Session, now: datetime | None = None) -> float | None:
    """
    Email the usage admins the first time this month's spend passes 80% and
    100% of the budget. Returns the share alerted about, if any.
    """
    from services import account_emails, mailer

    settings = get_settings()
    if limit_micros() is None or not settings.usage_admins or not settings.email_enabled:
        return None
    budget = current(db, now)
    share = budget.share or 0
    due = [level for level in ALERT_SHARES if share >= level and not _alerted(db, budget, level)]
    if not due:
        return None
    # The highest level passed: a jump straight past 100% sends one email, not two.
    level = due[-1]
    for crossed in due:
        app_events.record(
            db,
            app_events.AI_BUDGET_ALERT,
            details={"month": f"{budget.month:%Y-%m}", "share": crossed},
        )
    db.commit()
    for address in sorted(settings.usage_admins):
        mailer.send(account_emails.ai_budget_email(address, budget, level))
    logger.warning(
        "AI budget for %s at %d%%: alerted %d usage admins",
        f"{budget.month:%Y-%m}",
        round(share * 100),
        len(settings.usage_admins),
    )
    return level

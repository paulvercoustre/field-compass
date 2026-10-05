"""
Usage figures for whoever runs this instance: how many people signed up,
came back, connected Kobo, added surveys and pulled data. Only for the
emails listed in USAGE_ADMIN_EMAILS (services/app_events.can_view_usage).

Everything is counted in Python from a handful of plain queries, which keeps
it identical on Postgres and on the SQLite the tests run. The tables are small
(one row per user, survey, pull or active day), so this is cheap.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import (
    AIUsage,
    AppEvent,
    AudioTranscript,
    Run,
    SubmissionCurrent,
    SurveyConfig,
    User,
)
from services import app_events
from services.auth import get_current_active_user
from services.database import get_db
from services.runs import PULL

router = APIRouter()

WEEKS = 12
RECENT_SIGNUPS = 25


def require_usage_viewer(current_user: User = Depends(get_current_active_user)) -> User:
    if not app_events.can_view_usage(current_user):
        raise HTTPException(status_code=403, detail="Not available to this account")
    return current_user


def _naive_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def _week_start(day: datetime) -> datetime:
    """Monday 00:00 of the week `day` falls in."""
    day = day.replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=day.weekday())


def _source_label(details: dict | None) -> str:
    if not details:
        return "direct / unknown"
    return details.get("utm_source") or details.get("ref") or "direct / unknown"


@router.get("/admin/usage")
async def get_usage(
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_usage_viewer),
):
    now = datetime.utcnow()
    since_7 = now - timedelta(days=7)
    since_30 = now - timedelta(days=30)
    first_week = _week_start(now) - timedelta(weeks=WEEKS - 1)
    since_events = min(first_week, since_30)

    users = db.query(User).all()
    signups = [_naive_utc(u.created_at) for u in users if u.created_at]
    surveys = db.query(SurveyConfig.user_id, SurveyConfig.created_at).all()
    pulls = db.query(Run.started_by_user_id, Run.created_at).filter(Run.kind == PULL).all()
    events = (
        db.query(AppEvent.kind, AppEvent.user_id, AppEvent.details, AppEvent.created_at)
        .filter(AppEvent.created_at >= since_events)
        .all()
    )
    active = [
        (e.user_id, _naive_utc(e.created_at)) for e in events if e.kind == app_events.ACTIVE_DAY
    ]
    logins = [_naive_utc(e.created_at) for e in events if e.kind == app_events.LOGIN]

    def count_since(times, since):
        return sum(1 for t in times if t and _naive_utc(t) >= since)

    def active_since(since):
        return len({user_id for user_id, at in active if user_id and at >= since})

    submissions_30 = (
        db.query(func.count(SubmissionCurrent._id))
        .filter(SubmissionCurrent.created_at >= since_30)
        .scalar()
    )
    ai_30 = (
        db.query(
            func.count(AIUsage.usage_id),
            func.coalesce(func.sum(AIUsage.cost_usd_micros), 0),
        )
        .filter(
            AIUsage.created_at >= since_30,
            AIUsage.feature.notin_(("transcription", "translation")),
        )
        .one()
    )
    translated_30 = (
        db.query(func.count(AIUsage.usage_id))
        .filter(
            AIUsage.created_at >= since_30,
            AIUsage.feature == "translation",
            AIUsage.outcome == "ok",
        )
        .scalar()
    )
    # What the included allowance cost you: calls on the operator's key only
    operator_spend_30 = (
        db.query(func.coalesce(func.sum(AIUsage.cost_usd_micros), 0))
        .filter(AIUsage.created_at >= since_30, AIUsage.connection_id.is_(None))
        .scalar()
    )
    transcribed_30 = (
        db.query(
            func.count(AudioTranscript.transcript_id),
            func.coalesce(func.sum(AudioTranscript.audio_seconds), 0),
        )
        .filter(AudioTranscript.finished_at >= since_30, AudioTranscript.status == "success")
        .one()
    )

    # Logins and active days are only known from when app_events was added
    tracking_since = _naive_utc(db.query(func.min(AppEvent.created_at)).scalar())

    # Weekly trend: Monday-to-Sunday buckets, oldest first
    weeks = [first_week + timedelta(weeks=i) for i in range(WEEKS)]

    def bucket(at: datetime | None) -> int | None:
        at = _naive_utc(at)
        if at is None or at < first_week:
            return None
        return min((at - first_week).days // 7, WEEKS - 1)

    weekly = [
        {
            "week": w.date().isoformat(),
            "signups": 0,
            "active_users": set(),
            "surveys": 0,
            "pulls": 0,
        }
        for w in weeks
    ]
    for at in signups:
        if (i := bucket(at)) is not None:
            weekly[i]["signups"] += 1
    for user_id, at in active:
        if user_id and (i := bucket(at)) is not None:
            weekly[i]["active_users"].add(user_id)
    for _, at in surveys:
        if (i := bucket(at)) is not None:
            weekly[i]["surveys"] += 1
    for _, at in pulls:
        if (i := bucket(at)) is not None:
            weekly[i]["pulls"] += 1
    for row in weekly:
        row["active_users"] = len(row["active_users"])

    # Activation: how far each account has got
    survey_owners = {owner for owner, _ in surveys if owner}
    pullers = {user_id for user_id, _ in pulls if user_id}
    kobo_connected = {u.user_id for u in users if u.kobo_api_token_encrypted}
    funnel = [
        {"step": "Signed up", "users": len(users)},
        {"step": "Connected Kobo", "users": len(kobo_connected)},
        {"step": "Added a survey", "users": len(survey_owners)},
        {"step": "Pulled data", "users": len(pullers)},
    ]

    # Where signups came from, from the tags the marketing site forwards
    signup_events = {
        e.user_id: e.details for e in events if e.kind == app_events.SIGNUP and e.user_id
    }
    sources = Counter(
        _source_label(e.details)
        for e in events
        if e.kind == app_events.SIGNUP and _naive_utc(e.created_at) >= since_30
    )

    surveys_per_owner = Counter(owner for owner, _ in surveys if owner)
    recent = sorted(users, key=lambda u: _naive_utc(u.created_at) or datetime.min, reverse=True)
    recent_signups = [
        {
            "email": u.email,
            "full_name": u.full_name,
            "signed_up_at": u.created_at.isoformat() if u.created_at else None,
            "last_seen_at": last_seen.isoformat()
            if (last_seen := u.last_seen_at or u.last_login_at)
            else None,
            "source": _source_label(signup_events.get(u.user_id))
            if u.user_id in signup_events
            else None,
            "kobo_connected": u.user_id in kobo_connected,
            "surveys": surveys_per_owner.get(u.user_id, 0),
            "pulled": u.user_id in pullers,
        }
        for u in recent[:RECENT_SIGNUPS]
    ]

    return {
        "generated_at": now.isoformat() + "Z",
        "tracking_since": f"{tracking_since.isoformat()}Z" if tracking_since else None,
        "totals": {
            "users": len(users),
            "kobo_connected": len(kobo_connected),
            "surveys": len(surveys),
            "submissions": db.query(func.count(SubmissionCurrent._id)).scalar(),
        },
        "last_7_days": {
            "signups": count_since(signups, since_7),
            "active_users": active_since(since_7),
            "logins": count_since(logins, since_7),
            "surveys_created": count_since([at for _, at in surveys], since_7),
            "pulls": count_since([at for _, at in pulls], since_7),
        },
        "last_30_days": {
            "signups": count_since(signups, since_30),
            "active_users": active_since(since_30),
            "logins": count_since(logins, since_30),
            "surveys_created": count_since([at for _, at in surveys], since_30),
            "pulls": count_since([at for _, at in pulls], since_30),
            "submissions_synced": submissions_30,
            "ai_reviews": ai_30[0],
            "ai_cost_usd": round(ai_30[1] / 1_000_000, 2),
            "operator_ai_spend_usd": round(operator_spend_30 / 1_000_000, 2),
            "translations": translated_30 or 0,
            "transcriptions": transcribed_30[0],
            "audio_minutes": round(float(transcribed_30[1]) / 60, 1),
        },
        "weekly": weekly,
        "funnel": funnel,
        "signup_sources_30_days": [
            {"source": source, "signups": count} for source, count in sources.most_common()
        ],
        "recent_signups": recent_signups,
    }

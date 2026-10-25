"""
Usage figures for whoever runs this instance: how many people signed up,
came back, connected Kobo, added surveys, pulled data, turned checks on,
decided on submissions, and brought others in by sharing a survey or inviting
someone; how many signups got that far within a week, by signup week and by
where they came from. Only for the emails listed in USAGE_ADMIN_EMAILS
(services/app_events.can_view_usage).

Everything is counted in Python from a handful of plain queries, which keeps
it identical on Postgres and on the SQLite the tests run. The tables are small
(one row per user, survey, pull or active day), so this is cheap.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func

from database.models import (
    AIUsage,
    AppEvent,
    AudioTranscript,
    Run,
    SubmissionCurrent,
    SurveyAccess,
    SurveyConfig,
    SurveyInvitation,
    User,
    ValidationRule,
)
from services import ai_budget, app_events
from services.auth import CurrentUser
from services.database import DbSession
from services.runs import PULL

router = APIRouter()

WEEKS = 12
RECENT_SIGNUPS = 25
# Activated: within this many days of signing up, a survey of theirs was
# pulled, had a check on and got a review decision
ACTIVATION_DAYS = 7


def require_usage_viewer(current_user: CurrentUser) -> User:
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


def _first(times: dict, key, at: datetime | None) -> None:
    """Keep the earliest time seen for key."""
    if at is not None and (key not in times or at < times[key]):
        times[key] = at


SOURCE_STEPS = (
    "signups",
    "connected_kobo",
    "pulled",
    "checks_on",
    "decided",
    "activation_measured",
    "activated",
)


class _Journey:
    """
    When each account first got to each step, for activation: reached within
    ACTIVATION_DAYS of signing up. Survey steps are the owner's, whoever took
    them, since a coordinator often has a supervisor do the reviewing; an
    account is activated once one survey of theirs has all three.

    Review decisions are only known from the first one recorded
    (`measured_from`, the Monday of its week), so earlier signups are not
    measured rather than counted as never activated.
    """

    def __init__(self, *, surveys, pulls, review_events, decisions, events, measured_from):
        self.measured_from = measured_from
        owner_of = {s.survey_id: s.user_id for s in surveys}
        pulled: dict = {}
        for p in pulls:
            _first(pulled, p.survey_id, _naive_utc(p.created_at))
        checks: dict = {}
        for e in review_events:
            if e.kind == app_events.CHECKS_ON:
                _first(checks, e.survey_id, _naive_utc(e.created_at))
        decided: dict = {}
        for survey_id, _, at in decisions:
            _first(decided, survey_id, at)

        self.firsts: dict[str, dict] = {
            "connected_kobo": {},
            "added_survey": {},
            "pulled": {},
            "checks_on": {},
            "decided": {},
            "activated": {},
        }
        for e in events:
            if e.kind == app_events.KOBO_CONNECTED and e.user_id:
                _first(self.firsts["connected_kobo"], e.user_id, _naive_utc(e.created_at))
        for s in surveys:
            if s.user_id:
                _first(self.firsts["added_survey"], s.user_id, _naive_utc(s.created_at))
        for survey_id, owner in owner_of.items():
            if not owner:
                continue
            steps = (pulled.get(survey_id), checks.get(survey_id), decided.get(survey_id))
            for key, at in zip(("pulled", "checks_on", "decided"), steps, strict=True):
                _first(self.firsts[key], owner, at)
            if all(steps):
                _first(self.firsts["activated"], owner, max(at for at in steps if at))

    def _measured(self, user: User) -> bool:
        signed_up = _naive_utc(user.created_at)
        return (
            self.measured_from is not None
            and signed_up is not None
            and signed_up >= self.measured_from
        )

    def _reached(self, step: str, user: User) -> bool:
        at = self.firsts[step].get(user.user_id)
        signed_up = _naive_utc(user.created_at)
        return (
            at is not None
            and signed_up is not None
            and at <= signed_up + timedelta(days=ACTIVATION_DAYS)
        )

    def activated(self, user: User) -> bool | None:
        """Activated within ACTIVATION_DAYS of signing up; None when not measured."""
        return self._reached("activated", user) if self._measured(user) else None

    def cohort(self, week: datetime, users, by_invitation: set, now: datetime) -> dict:
        """
        The accounts that signed up that week on their own, and how many got
        to each step within ACTIVATION_DAYS. Accounts that joined through an
        invitation are counted apart: they came to review, not to set up.
        """
        end = week + timedelta(weeks=1)
        joined = [u for u in users if (at := _naive_utc(u.created_at)) and week <= at < end]
        own = [u for u in joined if u.user_id not in by_invitation]
        measured = self.measured_from is not None and week >= self.measured_from
        row: dict = {
            "week": week.date().isoformat(),
            "signups": len(own),
            "invited": len(joined) - len(own),
            "measured": measured,
            # Everyone in it has had their ACTIVATION_DAYS
            "complete": end + timedelta(days=ACTIVATION_DAYS) <= now,
        }
        for step in self.firsts:
            row[step] = sum(1 for u in own if self._reached(step, u)) if measured else None
        return row


@router.get("/admin/usage")
def get_usage(
    db: DbSession,
    _viewer: Annotated[User, Depends(require_usage_viewer)],
):
    now = datetime.utcnow()
    since_7 = now - timedelta(days=7)
    since_30 = now - timedelta(days=30)
    first_week = _week_start(now) - timedelta(weeks=WEEKS - 1)
    since_events = min(first_week, since_30)

    users = db.query(User).all()
    signups = [_naive_utc(u.created_at) for u in users if u.created_at]
    surveys = db.query(SurveyConfig.survey_id, SurveyConfig.user_id, SurveyConfig.created_at).all()
    pulls = (
        db.query(Run.survey_id, Run.started_by_user_id, Run.created_at)
        .filter(Run.kind == PULL)
        .all()
    )
    events = (
        db.query(AppEvent.kind, AppEvent.user_id, AppEvent.details, AppEvent.created_at)
        .filter(AppEvent.created_at >= since_events)
        .all()
    )
    active = [
        (e.user_id, _naive_utc(e.created_at)) for e in events if e.kind == app_events.ACTIVE_DAY
    ]
    logins = [_naive_utc(e.created_at) for e in events if e.kind == app_events.LOGIN]
    invites_sent = [_naive_utc(e.created_at) for e in events if e.kind == app_events.INVITE_SENT]
    invites_accepted = [
        _naive_utc(e.created_at) for e in events if e.kind == app_events.INVITE_ACCEPTED
    ]
    # Checks turned on and review decisions, all time: few rows (one per
    # survey, and one per reviewer, survey and day), and the first of each is
    # what the funnel and activation are counted from.
    review_events = (
        db.query(AppEvent.kind, AppEvent.user_id, AppEvent.survey_id, AppEvent.created_at)
        .filter(AppEvent.kind.in_((app_events.CHECKS_ON, app_events.REVIEW_DECISION)))
        .all()
    )
    decisions = [
        (e.survey_id, e.user_id, _naive_utc(e.created_at))
        for e in review_events
        if e.kind == app_events.REVIEW_DECISION
    ]

    def count_since(times, since):
        return sum(1 for t in times if t and _naive_utc(t) >= since)

    def active_since(since):
        return len({user_id for user_id, at in active if user_id and at >= since})

    def active_surveys_between(start, end=None):
        """The North Star: surveys with a pull and a review decision in the period."""

        def inside(at):
            at = _naive_utc(at)
            return at is not None and at >= start and (end is None or at < end)

        pulled = {p.survey_id for p in pulls if inside(p.created_at)}
        return len(pulled & {survey_id for survey_id, _, at in decisions if inside(at)})

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

    budget = ai_budget.current(db)

    # Logins and active days are only known from when app_events was added
    tracking_since = _naive_utc(db.query(func.min(AppEvent.created_at)).scalar())
    # Review decisions, and so activation, only from the first one recorded
    review_tracking_since = min((at for _, _, at in decisions if at), default=None)

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
            "active_surveys": active_surveys_between(w, w + timedelta(weeks=1)),
        }
        for w in weeks
    ]
    for at in signups:
        if (i := bucket(at)) is not None:
            weekly[i]["signups"] += 1
    for user_id, at in active:
        if user_id and (i := bucket(at)) is not None:
            weekly[i]["active_users"].add(user_id)
    for survey in surveys:
        if (i := bucket(survey.created_at)) is not None:
            weekly[i]["surveys"] += 1
    for pull in pulls:
        if (i := bucket(pull.created_at)) is not None:
            weekly[i]["pulls"] += 1
    for row in weekly:
        row["active_users"] = len(row["active_users"])

    # How far each account has got, all time. Each step counts the accounts
    # that have done it, so someone invited to review a colleague's survey
    # counts from "Made a review decision" without having added one.
    owner_of = {s.survey_id: s.user_id for s in surveys}
    survey_owners = {s.user_id for s in surveys if s.user_id}
    pullers = {p.started_by_user_id for p in pulls if p.started_by_user_id}
    kobo_connected = {u.user_id for u in users if u.kobo_api_token_encrypted}
    confirmed = {u.user_id for u in users if u.email_verified_at}
    # A check on: an active rule of the survey's own, or the event recorded
    # when its first check went on (built-in checks leave no row of their own)
    surveys_with_checks = {
        survey_id
        for (survey_id,) in db.query(ValidationRule.survey_id)
        .filter(ValidationRule.is_active.is_(True))
        .distinct()
    } | {e.survey_id for e in review_events if e.kind == app_events.CHECKS_ON}
    check_owners = {owner_of[s] for s in surveys_with_checks if owner_of.get(s)}
    deciders = {user_id for _, user_id, _ in decisions if user_id}
    surveys_per_owner = Counter(s.user_id for s in surveys if s.user_id)
    # Brought someone in: gave a survey to an account, or invited an address.
    # From the tables rather than events, so it reaches back before them.
    sharers = {
        granter for (granter,) in db.query(SurveyAccess.granted_by).distinct() if granter
    } | {inviter for (inviter,) in db.query(SurveyInvitation.invited_by).distinct() if inviter}
    funnel = [
        {"step": "Signed up", "users": len(users)},
        {"step": "Confirmed their email", "users": len(confirmed)},
        {"step": "Connected Kobo", "users": len(kobo_connected)},
        {"step": "Added a survey", "users": len(survey_owners)},
        {"step": "Pulled data", "users": len(pullers)},
        {"step": "Turned on a check", "users": len(check_owners)},
        {"step": "Made a review decision", "users": len(deciders)},
        {"step": "Shared a survey", "users": len(sharers)},
        {
            "step": "Added a second survey",
            "users": sum(1 for n in surveys_per_owner.values() if n >= 2),
        },
    ]

    # Where signups came from, from the tags the marketing site forwards
    signup_events = {
        e.user_id: e.details for e in events if e.kind == app_events.SIGNUP and e.user_id
    }
    journey = _Journey(
        surveys=surveys,
        pulls=pulls,
        review_events=review_events,
        decisions=decisions,
        events=events,
        measured_from=_week_start(review_tracking_since) if review_tracking_since else None,
    )
    by_invitation = {
        user_id
        for user_id, details in signup_events.items()
        if details and details.get("ref") == "invite"
    }
    activation = [journey.cohort(w, users, by_invitation, now) for w in weeks]

    by_source: dict[str, dict[str, int]] = {}
    for u in users:
        if u.user_id not in signup_events:
            continue
        row = by_source.setdefault(
            _source_label(signup_events[u.user_id]),
            dict.fromkeys(SOURCE_STEPS, 0),
        )
        row["signups"] += 1
        row["connected_kobo"] += u.user_id in kobo_connected
        row["pulled"] += u.user_id in pullers
        row["checks_on"] += u.user_id in check_owners
        row["decided"] += u.user_id in deciders
        if (activated := journey.activated(u)) is not None:
            row["activation_measured"] += 1
            row["activated"] += activated
    signup_funnel_by_source = [
        {"source": source, **row}
        for source, row in sorted(by_source.items(), key=lambda item: -item[1]["signups"])
    ]

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
            "checks_on": u.user_id in check_owners,
            "decided": u.user_id in deciders,
            "activated": journey.activated(u),
        }
        for u in recent[:RECENT_SIGNUPS]
    ]

    return {
        "generated_at": now.isoformat() + "Z",
        "tracking_since": f"{tracking_since.isoformat()}Z" if tracking_since else None,
        "review_tracking_since": f"{review_tracking_since.isoformat()}Z"
        if review_tracking_since
        else None,
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
            "surveys_created": count_since([s.created_at for s in surveys], since_7),
            "pulls": count_since([p.created_at for p in pulls], since_7),
            "active_surveys": active_surveys_between(since_7),
            "invites_sent": count_since(invites_sent, since_7),
            "invites_accepted": count_since(invites_accepted, since_7),
        },
        "last_30_days": {
            "signups": count_since(signups, since_30),
            "active_users": active_since(since_30),
            "logins": count_since(logins, since_30),
            "surveys_created": count_since([s.created_at for s in surveys], since_30),
            "pulls": count_since([p.created_at for p in pulls], since_30),
            "active_surveys": active_surveys_between(since_30),
            "invites_sent": count_since(invites_sent, since_30),
            "invites_accepted": count_since(invites_accepted, since_30),
            "submissions_synced": submissions_30,
            "ai_reviews": ai_30[0],
            "ai_cost_usd": round(ai_30[1] / 1_000_000, 2),
            "operator_ai_spend_usd": round(operator_spend_30 / 1_000_000, 2),
            "translations": translated_30 or 0,
            "transcriptions": transcribed_30[0],
            "audio_minutes": round(float(transcribed_30[1]) / 60, 1),
        },
        # This calendar month on Field Compass's keys, against AI_MONTHLY_BUDGET_USD
        "ai_budget": {
            "month": f"{budget.month:%Y-%m}",
            "spent_usd": round(budget.spent_micros / 1_000_000, 2),
            "budget_usd": round(budget.limit_micros / 1_000_000, 2)
            if budget.limit_micros
            else None,
            "paused": budget.paused,
            "resumes_at": f"{budget.resumes_at.isoformat()}Z",
            "unpriced": [{"model": item.model, "calls": item.calls} for item in budget.unpriced],
        },
        "weekly": weekly,
        "funnel": funnel,
        "activation_days": ACTIVATION_DAYS,
        "activation": activation,
        "signup_funnel_by_source": signup_funnel_by_source,
        "recent_signups": recent_signups,
    }

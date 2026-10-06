"""
A user's own AI keys, and which one each survey uses.

Two kinds: "review" keys are OpenAI-compatible providers, for AI review and
rule writing, and for translation; "transcription" keys are ElevenLabs keys
for audio transcription. A survey picks at most one key for each feature --
AI review, translation (an OpenAI-compatible key, chosen apart from AI
review's) and transcription; without one a feature runs on the operator's
keys, within the included usage.

A connection belongs to the user who created it: only they can see, edit,
test, delete or attach it, and only to surveys they own. The key goes in and
never comes out -- responses carry its last four characters.

See docs/specs/ai-provider-overhaul.md, sections 6.3 and 9.
"""

import logging
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import AIConnection, AIUsage, SurveyConfig, User
from etl.audio import transcription_settings
from etl.translation import translation_settings
from services.ai_allowance import (
    Account,
    allowance_enabled,
    checks_in_flight,
    checks_per_month,
    checks_used,
    month_start,
    next_month_start,
    rule_requests_per_user_month,
    rule_requests_remaining,
    translations_in_flight,
    translations_per_month,
    translations_used,
)
from services.ai_endpoints import EndpointRejected, validate_base_url
from services.ai_providers import (
    UNTESTED,
    run_connection_test,
    survey_connection,
    translation_connection,
)
from services.ai_usage import QUALITATIVE_CHECK
from services.ai_usage import TRANSCRIPTION as TRANSCRIPTION_FEATURE
from services.ai_usage import TRANSLATION as TRANSLATION_FEATURE
from services.auth import CurrentUser, encrypt_api_key
from services.database import DbSession
from services.permissions import OwnedSurvey
from services.rate_limit import limiter
from services.transcription_allowance import minutes_per_month, seconds_on_own_key
from services.transcription_allowance import seconds_on_survey as transcription_seconds_on_survey
from services.transcription_allowance import seconds_used as transcription_seconds_used
from services.transcription_keys import (
    ELEVENLABS,
    REVIEW,
    TRANSCRIPTION,
    run_transcription_key_test,
    survey_transcription_connection,
)
from services.transcription_keys import base_url as transcription_base_url
from services.transcription_keys import model as transcription_model
from settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

Preset = Literal[
    "openai",
    "azure",
    "anthropic",
    "openrouter",
    "mistral",
    "groq",
    "self_hosted",
    "custom",
    "elevenlabs",
]
Kind = Literal["review", "transcription"]
# What a survey uses a key for: a review key serves AI review or translation.
Use = Literal["review", "translation", "transcription"]
TRANSLATION = "translation"


class ConnectionCreate(BaseModel):
    kind: Kind = "review"
    label: str = Field(..., min_length=1, max_length=120)
    preset: Preset = "custom"
    # Review keys only: a transcription key always goes to ElevenLabs.
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    check_model: str | None = Field(default=None, min_length=1, max_length=128)
    rule_model: str | None = Field(default=None, max_length=128)


class ConnectionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    preset: Preset | None = None
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    # Omitted or null keeps the stored key; a new value replaces it.
    api_key: str | None = Field(default=None, max_length=500)
    check_model: str | None = Field(default=None, min_length=1, max_length=128)
    rule_model: str | None = Field(default=None, max_length=128)


class SurveyConnectionUpdate(BaseModel):
    connection_id: UUID | None = None  # None: the operator's key
    kind: Use = "review"


def connection_summary(connection: AIConnection) -> dict:
    """What anyone with access to a survey may see about its provider."""
    return {
        "connection_id": str(connection.connection_id),
        "kind": connection.kind or REVIEW,
        "label": connection.label,
        "preset": connection.preset,
        "host": urlsplit(connection.base_url).hostname,
        "check_model": connection.check_model,
        "status": connection.status,
        "last_error": connection.last_error,
    }


def _connection_out(db: Session, connection: AIConnection, test: dict | None = None) -> dict:
    # What each survey uses this key for.
    columns = (
        {TRANSCRIPTION: SurveyConfig.transcription_connection_id}
        if connection.kind == TRANSCRIPTION
        else {
            REVIEW: SurveyConfig.ai_connection_id,
            TRANSLATION: SurveyConfig.translation_connection_id,
        }
    )
    uses: dict = {}
    for use, column in columns.items():
        for sid, name in db.query(SurveyConfig.survey_id, SurveyConfig.survey_name).filter(
            column == connection.connection_id
        ):
            uses.setdefault(sid, {"survey_id": str(sid), "survey_name": name, "uses": []})
            uses[sid]["uses"].append(use)
    out = {
        **connection_summary(connection),
        "base_url": connection.base_url,
        "api_key_hint": connection.api_key_hint,
        "has_api_key": bool(connection.api_key_encrypted),
        "rule_model": connection.rule_model,
        "capabilities": connection.capabilities,
        "last_tested_at": (
            connection.last_tested_at.isoformat() if connection.last_tested_at else None
        ),
        "surveys": sorted(uses.values(), key=lambda survey: survey["survey_name"] or ""),
    }
    if test is not None:
        out["test"] = test
    return out


def _owned_connection(db: Session, user: User, connection_id: str) -> AIConnection:
    try:
        uuid = UUID(connection_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="AI provider not found") from None
    connection = db.get(AIConnection, uuid)
    # Someone else's connection is reported as missing, not forbidden.
    if connection is None or connection.owner_user_id != user.user_id:
        raise HTTPException(status_code=404, detail="AI provider not found")
    return connection


def _test(connection: AIConnection) -> dict:
    """Check a key the way its kind is checked."""
    if connection.kind == TRANSCRIPTION:
        return run_transcription_key_test(connection)
    return run_connection_test(connection)


def _checked_url(url: str) -> str:
    try:
        return validate_base_url(url)
    except EndpointRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _set_key(connection: AIConnection, api_key: str | None) -> None:
    key = (api_key or "").strip()
    if key:
        connection.api_key_encrypted = encrypt_api_key(key)
        connection.api_key_hint = key[-4:]


@router.get("/ai/connections")
async def list_connections(
    db: DbSession,
    current_user: CurrentUser,
):
    """The current user's AI providers. Keys are never included."""
    connections = (
        db.query(AIConnection)
        .filter(AIConnection.owner_user_id == current_user.user_id)
        .order_by(AIConnection.created_at)
        .all()
    )
    return [_connection_out(db, connection) for connection in connections]


@router.post("/ai/connections", status_code=201)
@limiter.limit("20/hour")
async def create_connection(
    request: Request,
    payload: ConnectionCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Save a key and test it. A review provider that fails its test is still
    saved, marked failing (an endpoint can be down briefly). A transcription
    key ElevenLabs refuses is not saved.
    """
    if payload.kind == TRANSCRIPTION:
        key = (payload.api_key or "").strip()
        if len(key) < 20:
            raise HTTPException(
                status_code=400,
                detail="That's too short to be an ElevenLabs API key. Copy the whole key.",
            )
        connection = AIConnection(
            owner_user_id=current_user.user_id,
            kind=TRANSCRIPTION,
            label=payload.label.strip(),
            preset=ELEVENLABS,
            base_url=transcription_base_url(),
            check_model=transcription_model(),
            status=UNTESTED,
            consecutive_failures=0,
        )
        _set_key(connection, key)
        test = run_transcription_key_test(connection)
        if not test["ok"] and test.get("category") in ("auth", "bad_request"):
            raise HTTPException(status_code=400, detail=test["error"])
        db.add(connection)
        db.commit()
        return _connection_out(db, connection, test)

    if not payload.base_url or not payload.check_model:
        raise HTTPException(status_code=400, detail="Enter the provider's address and model.")
    connection = AIConnection(
        owner_user_id=current_user.user_id,
        kind=REVIEW,
        label=payload.label.strip(),
        preset=payload.preset,
        base_url=_checked_url(payload.base_url),
        check_model=payload.check_model.strip(),
        rule_model=(payload.rule_model or "").strip() or None,
        status=UNTESTED,
        consecutive_failures=0,
    )
    _set_key(connection, payload.api_key)
    db.add(connection)
    db.flush()
    test = run_connection_test(connection)
    db.commit()
    return _connection_out(db, connection, test)


@router.patch("/ai/connections/{connection_id}")
@limiter.limit("20/hour")
async def update_connection(
    request: Request,
    connection_id: str,
    payload: ConnectionUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Edit a provider. Changing where or how it connects re-runs the test."""
    connection = _owned_connection(db, current_user, connection_id)
    changes_connection = False

    if connection.kind == TRANSCRIPTION:
        # Only its name and key change: it always goes to ElevenLabs.
        if payload.label is not None:
            connection.label = payload.label.strip()
        test = None
        if payload.api_key:
            previous = (connection.api_key_encrypted, connection.api_key_hint)
            _set_key(connection, payload.api_key)
            test = run_transcription_key_test(connection)
            if not test["ok"] and test.get("category") in ("auth", "bad_request"):
                db.rollback()
                connection.api_key_encrypted, connection.api_key_hint = previous
                raise HTTPException(status_code=400, detail=test["error"])
        db.commit()
        return _connection_out(db, connection, test)

    if payload.label is not None:
        connection.label = payload.label.strip()
    if payload.preset is not None:
        connection.preset = payload.preset
    if payload.base_url is not None:
        connection.base_url = _checked_url(payload.base_url)
        changes_connection = True
    if payload.api_key:
        _set_key(connection, payload.api_key)
        changes_connection = True
    if payload.check_model is not None:
        connection.check_model = payload.check_model.strip()
        changes_connection = True
    if "rule_model" in payload.model_fields_set:
        connection.rule_model = (payload.rule_model or "").strip() or None

    test = None
    if changes_connection:
        connection.capabilities = None  # a different endpoint or model: learn again
        test = run_connection_test(connection)
    db.commit()
    return _connection_out(db, connection, test)


@router.post("/ai/connections/{connection_id}/test")
@limiter.limit("20/hour")
async def test_connection(
    request: Request,
    connection_id: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Test a key again. A pass resumes a paused one."""
    connection = _owned_connection(db, current_user, connection_id)
    test = _test(connection)
    db.commit()
    return _connection_out(db, connection, test)


@router.delete("/ai/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Delete a provider. Surveys using it go back to the operator's key."""
    connection = _owned_connection(db, current_user, connection_id)
    db.query(SurveyConfig).filter(SurveyConfig.ai_connection_id == connection.connection_id).update(
        {SurveyConfig.ai_connection_id: None}, synchronize_session=False
    )
    db.query(SurveyConfig).filter(
        SurveyConfig.transcription_connection_id == connection.connection_id
    ).update({SurveyConfig.transcription_connection_id: None}, synchronize_session=False)
    db.query(SurveyConfig).filter(
        SurveyConfig.translation_connection_id == connection.connection_id
    ).update({SurveyConfig.translation_connection_id: None}, synchronize_session=False)
    db.delete(connection)
    db.commit()


@router.put("/surveys/{survey_id}/ai-connection")
async def set_survey_connection(
    payload: SurveyConnectionUpdate,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Use one of the owner's keys for this survey, or the operator's key (null):
    a review key for AI review or for translation, or a transcription key for
    transcription.
    """
    connection = None
    if payload.connection_id is not None:
        connection = _owned_connection(db, current_user, str(payload.connection_id))
        wanted = TRANSCRIPTION if payload.kind == TRANSCRIPTION else REVIEW
        if (connection.kind or REVIEW) != wanted:
            raise HTTPException(
                status_code=400,
                detail="That key is for "
                + (
                    "audio transcription."
                    if connection.kind == TRANSCRIPTION
                    else "AI review and translation."
                ),
            )
        if survey.user_id != current_user.user_id:
            # An admin can reach this endpoint for any survey, but a key is
            # spent on behalf of the survey's owner, not the admin.
            raise HTTPException(
                status_code=403, detail="Only the survey's owner can attach their provider."
            )

    if payload.kind == TRANSCRIPTION:
        survey.transcription_connection_id = connection.connection_id if connection else None
    elif payload.kind == TRANSLATION:
        survey.translation_connection_id = connection.connection_id if connection else None
    else:
        survey.ai_connection_id = connection.connection_id if connection else None
    db.commit()
    logger.info(
        "Survey %s now uses %s",
        survey.survey_id,
        f"AI connection {connection.connection_id}" if connection else "the operator key",
    )
    return {"ai_connection": connection_summary(connection) if connection else None}


@router.get("/ai/usage")
async def account_ai_usage(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    This month's AI use on every survey the current user owns, and their
    free AI rule requests this month.

    Per survey: which provider it runs on, its free allowance when that is
    the operator's key, and calls, failures and tokens by feature. Tokens are
    as reported by the provider; no cost is computed, since prices differ by
    provider and change.
    """
    since = month_start()
    surveys = (
        db.query(SurveyConfig)
        .filter(SurveyConfig.user_id == current_user.user_id)
        .order_by(SurveyConfig.survey_name)
        .all()
    )

    totals: dict = {}
    if surveys:
        rows = (
            db.query(
                AIUsage.survey_id,
                AIUsage.feature,
                AIUsage.outcome,
                func.count(AIUsage.usage_id),
                func.coalesce(func.sum(AIUsage.input_tokens), 0),
                func.coalesce(func.sum(AIUsage.output_tokens), 0),
            )
            .filter(
                AIUsage.survey_id.in_([survey.survey_id for survey in surveys]),
                AIUsage.created_at >= since,
            )
            .group_by(AIUsage.survey_id, AIUsage.feature, AIUsage.outcome)
            .all()
        )
        for survey_id, feature, outcome, calls, input_tokens, output_tokens in rows:
            entry = totals.setdefault(survey_id, {}).setdefault(
                feature,
                {
                    "feature": feature,
                    "calls": 0,
                    "failed": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                },
            )
            entry["calls"] += calls
            entry["input_tokens"] += int(input_tokens)
            entry["output_tokens"] += int(output_tokens)
            # "reserved": a transcription under way, not a failure.
            if outcome not in ("ok", "reserved"):
                entry["failed"] += calls

    enabled = allowance_enabled()
    account = Account(user_id=current_user.user_id)
    check_limit = checks_per_month() if enabled else 0
    translation_limit = translations_per_month() if enabled else 0
    minutes_limit = minutes_per_month() if get_settings().operator_transcription_key else None

    def meter(limit: int, used: int, in_flight: int) -> dict:
        return {
            "limit": limit,
            "used": used,
            "in_flight": in_flight,
            "remaining": max(0, limit - used - in_flight),
        }

    used_seconds = transcription_seconds_used(db, account)
    # This month's included usage, shared by every survey the user owns.
    included_usage = {
        "reviews": meter(check_limit, checks_used(db, account), checks_in_flight(db, account))
        if check_limit
        else None,
        "translations": meter(
            translation_limit, translations_used(db, account), translations_in_flight(db, account)
        )
        if translation_limit
        else None,
        "transcription": {
            "limit_minutes": minutes_limit,
            "used_minutes": round(used_seconds / 60, 1),
            "remaining_minutes": round(max(0.0, minutes_limit * 60 - used_seconds) / 60, 1),
        }
        if minutes_limit is not None
        else None,
    }

    def spent(survey_id, feature: str):
        return (
            AIUsage.survey_id == survey_id,
            AIUsage.feature == feature,
            AIUsage.outcome.in_(("ok", "bad_response")),
            AIUsage.created_at >= since,
        )

    out = []
    for survey in surveys:
        connection = survey_connection(db, survey)
        own_transcription = survey_transcription_connection(db, survey)
        own_translation = translation_connection(db, survey)
        features = totals.get(survey.survey_id, {})
        reviews = (
            db.query(func.count(func.distinct(AIUsage.submission_id)))
            .filter(*spent(survey.survey_id, QUALITATIVE_CHECK))
            .scalar()
        ) or 0
        transcription = None
        if "transcription" in features or transcription_settings(survey.config_data).enabled:
            transcription = {
                # On the owner's own ElevenLabs key: no Field Compass limit.
                "provider": connection_summary(own_transcription) if own_transcription else None,
                "minutes": round(
                    (
                        seconds_on_own_key(db, survey.survey_id)
                        if own_transcription
                        else transcription_seconds_on_survey(db, survey.survey_id)
                    )
                    / 60,
                    1,
                ),
            }
        translation = None
        if TRANSLATION_FEATURE in features or translation_settings(survey.config_data).enabled:
            translation = {
                # On the owner's own key: no Field Compass limit.
                "provider": connection_summary(own_translation) if own_translation else None,
                "translations": (
                    db.query(func.count(AIUsage.usage_id))
                    .filter(*spent(survey.survey_id, TRANSLATION_FEATURE))
                    .scalar()
                )
                or 0,
            }
        out.append(
            {
                "survey_id": str(survey.survey_id),
                "survey_name": survey.survey_name,
                # Its own AI review provider; null when it uses the included usage.
                "provider": connection_summary(connection) if connection else None,
                "reviews": reviews,
                "transcription": transcription,
                "translation": translation,
                "by_feature": sorted(features.values(), key=lambda entry: entry["feature"]),
            }
        )

    rule_limit = rule_requests_per_user_month() if enabled else 0
    rule_left = rule_requests_remaining(db, current_user.user_id)
    return {
        "month": since.strftime("%Y-%m"),
        "resets_at": next_month_start().isoformat() + "Z",
        # What the user's account includes on Field Compass's keys each month,
        # shared by all their surveys; 0 or None when this server includes none.
        "included": {
            "reviews_per_month": check_limit,
            "translations_per_month": translation_limit,
            "transcription_minutes_per_month": minutes_limit,
            "rule_requests_per_month": rule_limit,
        },
        "included_usage": included_usage,
        "rule_requests_this_month": {
            "limit": rule_limit,
            "used": rule_limit - rule_left,
            "remaining": rule_left,
        },
        "surveys": out,
    }


@router.get("/ai/usage/history")
async def account_ai_usage_history(
    db: DbSession,
    current_user: CurrentUser,
    metric: Literal["reviews", "translations", "minutes"] = "reviews",
    period: Literal["30d", "6m"] = "30d",
    survey_id: UUID | None = None,
):
    """
    AI use over time on the surveys the caller owns, for the usage chart.

    ``reviews``: submissions reviewed by AI; ``translations``: answers
    translated; ``minutes``: minutes of audio transcribed. Daily over 30 days, or monthly over 6 months, each split
    between the included usage (Field Compass's keys) and the caller's own.
    """
    owned = {
        sid
        for (sid,) in db.query(SurveyConfig.survey_id).filter(
            SurveyConfig.user_id == current_user.user_id
        )
    }
    if survey_id is not None:
        if survey_id not in owned:
            raise HTTPException(status_code=404, detail="Survey not found")
        owned = {survey_id}

    now = datetime.utcnow()
    if period == "30d":
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [today - timedelta(days=offset) for offset in range(29, -1, -1)]
        bucket_of = lambda when: when.replace(hour=0, minute=0, second=0, microsecond=0)  # noqa: E731
    else:
        first = month_start(now)
        starts = []
        for _ in range(6):
            starts.insert(0, first)
            first = month_start(first - timedelta(days=1))
        bucket_of = month_start
    since = starts[0]

    values = {start: {"included": 0.0, "own": 0.0} for start in starts}
    if owned:
        if metric in ("reviews", "translations"):
            amount = func.count(AIUsage.usage_id)
            feature = QUALITATIVE_CHECK if metric == "reviews" else TRANSLATION_FEATURE
        else:
            amount = func.coalesce(func.sum(AIUsage.audio_seconds), 0)
            feature = TRANSCRIPTION_FEATURE
        rows = (
            db.query(AIUsage.created_at, AIUsage.connection_id.isnot(None), amount)
            .filter(
                AIUsage.survey_id.in_(owned),
                AIUsage.feature == feature,
                AIUsage.outcome == "ok",
                AIUsage.created_at >= since,
            )
            .group_by(AIUsage.created_at, AIUsage.connection_id.isnot(None))
            .all()
        )
        for created_at, own, value in rows:
            when = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
            start = bucket_of(when)
            if start in values:
                values[start]["own" if own else "included"] += float(value or 0)

    def shown(value: float) -> float:
        return round(value / 60, 1) if metric == "minutes" else int(value)

    buckets = [
        {
            "start": start.date().isoformat(),
            "included": shown(values[start]["included"]),
            "own": shown(values[start]["own"]),
        }
        for start in starts
    ]
    return {
        "metric": metric,
        "period": period,
        "unit": "day" if period == "30d" else "month",
        "buckets": buckets,
        "total_included": round(sum(b["included"] for b in buckets), 1),
        "total_own": round(sum(b["own"] for b in buckets), 1),
    }

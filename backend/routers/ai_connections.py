"""
A user's own AI providers, and which one a survey uses.

A connection belongs to the user who created it: only they can see, edit,
test, delete or attach it, and only to surveys they own. The key goes in and
never comes out -- responses carry its last four characters.

See docs/specs/ai-provider-overhaul.md, sections 6.3 and 9.
"""

import logging
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.models import AIConnection, SurveyConfig, User
from services.ai_endpoints import EndpointRejected, validate_base_url
from services.ai_providers import UNTESTED, run_connection_test
from services.auth import encrypt_api_key, get_current_active_user
from services.database import get_db
from services.permissions import require_survey_access
from services.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

Preset = Literal["openai", "azure", "openrouter", "mistral", "groq", "self_hosted", "custom"]


class ConnectionCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    preset: Preset = "custom"
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str | None = Field(None, max_length=500)
    check_model: str = Field(..., min_length=1, max_length=128)
    rule_model: str | None = Field(None, max_length=128)


class ConnectionUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=120)
    preset: Preset | None = None
    base_url: str | None = Field(None, min_length=1, max_length=500)
    # Omitted or null keeps the stored key; a new value replaces it.
    api_key: str | None = Field(None, max_length=500)
    check_model: str | None = Field(None, min_length=1, max_length=128)
    rule_model: str | None = Field(None, max_length=128)


class SurveyConnectionUpdate(BaseModel):
    connection_id: UUID | None = None  # None: the operator's key


def connection_summary(connection: AIConnection) -> dict:
    """What anyone with access to a survey may see about its provider."""
    return {
        "connection_id": str(connection.connection_id),
        "label": connection.label,
        "preset": connection.preset,
        "host": urlsplit(connection.base_url).hostname,
        "check_model": connection.check_model,
        "status": connection.status,
        "last_error": connection.last_error,
    }


def _connection_out(db: Session, connection: AIConnection, test: dict | None = None) -> dict:
    surveys = (
        db.query(SurveyConfig.survey_id, SurveyConfig.survey_name)
        .filter(SurveyConfig.ai_connection_id == connection.connection_id)
        .all()
    )
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
        "surveys": [{"survey_id": str(sid), "survey_name": name} for sid, name in surveys],
    }
    if test is not None:
        out["test"] = test
    return out


def _owned_connection(db: Session, user: User, connection_id: str) -> AIConnection:
    try:
        uuid = UUID(connection_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="AI provider not found")
    connection = db.get(AIConnection, uuid)
    # Someone else's connection is reported as missing, not forbidden.
    if connection is None or connection.owner_user_id != user.user_id:
        raise HTTPException(status_code=404, detail="AI provider not found")
    return connection


def _checked_url(url: str) -> str:
    try:
        return validate_base_url(url)
    except EndpointRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _set_key(connection: AIConnection, api_key: str | None) -> None:
    key = (api_key or "").strip()
    if key:
        connection.api_key_encrypted = encrypt_api_key(key)
        connection.api_key_hint = key[-4:]


@router.get("/ai/connections")
async def list_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Save a provider and test it. A failing test still saves it, marked failing."""
    connection = AIConnection(
        owner_user_id=current_user.user_id,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Edit a provider. Changing where or how it connects re-runs the test."""
    connection = _owned_connection(db, current_user, connection_id)
    changes_connection = False

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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Test a provider again. A pass resumes a paused one."""
    connection = _owned_connection(db, current_user, connection_id)
    test = run_connection_test(connection)
    db.commit()
    return _connection_out(db, connection, test)


@router.delete("/ai/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a provider. Surveys using it go back to the operator's key."""
    connection = _owned_connection(db, current_user, connection_id)
    db.query(SurveyConfig).filter(SurveyConfig.ai_connection_id == connection.connection_id).update(
        {SurveyConfig.ai_connection_id: None}, synchronize_session=False
    )
    db.delete(connection)
    db.commit()


@router.put("/surveys/{survey_id}/ai-connection")
async def set_survey_connection(
    survey_id: str,
    payload: SurveyConnectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Use one of the owner's providers for this survey, or the operator's key (null)."""
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid survey_id format: {survey_id}")
    survey = require_survey_access(db, current_user, survey_uuid, min_level="owner")

    connection = None
    if payload.connection_id is not None:
        connection = _owned_connection(db, current_user, str(payload.connection_id))
        if survey.user_id != current_user.user_id:
            # An admin can reach this endpoint for any survey, but a key is
            # spent on behalf of the survey's owner, not the admin.
            raise HTTPException(
                status_code=403, detail="Only the survey's owner can attach their provider."
            )

    survey.ai_connection_id = connection.connection_id if connection else None
    db.commit()
    logger.info(
        "Survey %s now uses %s",
        survey.survey_id,
        f"AI connection {connection.connection_id}" if connection else "the operator key",
    )
    return {"ai_connection": connection_summary(connection) if connection else None}

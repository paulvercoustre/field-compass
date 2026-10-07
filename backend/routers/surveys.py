"""
Survey configuration API endpoints.
Provides access to survey configurations with permission-based access control.
"""

import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, SurveyConfig, User, ValidationRule
from routers.ai_connections import connection_summary
from services import app_events
from services.ai_providers import survey_connection
from services.auth import CurrentUser
from services.database import DbSession
from services.permissions import (
    OwnedSurvey,
    ViewableSurvey,
    get_accessible_surveys,
    get_survey_access_list,
    get_user_permission,
    grant_survey_access,
    parse_uuid,
    revoke_survey_access,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# config_data keys saved through their own endpoint (and validated there).
OWN_ENDPOINT_KEYS = ("audio_transcription", "translation")


def _ai_connection_summary(db: Session, survey: SurveyConfig) -> dict | None:
    connection = survey_connection(db, survey)
    return connection_summary(connection) if connection else None


# =============================================================================
# Pydantic Models
# =============================================================================


class SurveyConfigUpdate(BaseModel):
    survey_name: str | None = None
    kobo_asset_id: str | None = None
    config_data: dict[str, Any] | None = None


class SurveyCreate(BaseModel):
    survey_name: str = Field(..., min_length=1, max_length=255)
    kobo_asset_id: str | None = None
    config_data: dict[str, Any] = Field(default_factory=dict)


class ShareSurveyRequest(BaseModel):
    email: EmailStr
    permission_level: Literal["editor", "viewer"]


class UpdateAccessRequest(BaseModel):
    permission_level: Literal["editor", "viewer"]


# =============================================================================
# Survey CRUD Endpoints
# =============================================================================


@router.get("/surveys")
async def get_surveys(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get list of surveys the user has access to.
    Returns surveys the user owns plus surveys shared with them.
    Admins can see all surveys.
    """
    surveys = get_accessible_surveys(db, current_user)

    result = []
    for survey in surveys:
        permission = get_user_permission(db, current_user, survey.survey_id)
        result.append(
            {
                "survey_id": str(survey.survey_id),
                "survey_name": survey.survey_name,
                "kobo_asset_id": survey.kobo_asset_id,
                "permission": permission,
                "owner_id": str(survey.user_id) if survey.user_id else None,
                "is_owner": survey.user_id == current_user.user_id,
            }
        )

    return result


@router.get("/surveys/{survey_id}")
async def get_survey(
    survey: ViewableSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a specific survey by ID with full configuration.
    Requires at least viewer access.
    """
    permission = get_user_permission(db, current_user, survey.survey_id)

    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "permission": permission,
        "owner_id": str(survey.user_id) if survey.user_id else None,
        "is_owner": survey.user_id == current_user.user_id,
        # Which AI provider the survey uses; null is the operator's key.
        "ai_connection": _ai_connection_summary(db, survey),
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
        "updated_at": updated_at.isoformat() if (updated_at := survey.updated_at) else None,
    }


@router.post("/surveys", status_code=201)
async def create_survey(
    survey_data: SurveyCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create a new survey configuration.
    The current user becomes the owner of the survey.
    """
    # Check if survey name already exists
    existing = (
        db.query(SurveyConfig).filter(SurveyConfig.survey_name == survey_data.survey_name).first()
    )

    if existing:
        raise HTTPException(
            status_code=400, detail=f"Survey with name '{survey_data.survey_name}' already exists"
        )

    # Create new survey with current user as owner
    survey = SurveyConfig(
        survey_name=survey_data.survey_name,
        kobo_asset_id=survey_data.kobo_asset_id,
        config_data=survey_data.config_data,
        user_id=current_user.user_id,  # Set owner
    )

    db.add(survey)
    db.flush()
    app_events.record(db, app_events.SURVEY_CREATED, user=current_user, survey_id=survey.survey_id)
    db.commit()
    db.refresh(survey)

    logger.info(f"User {current_user.email} created survey {survey.survey_id}")

    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "permission": "owner",
        "owner_id": str(survey.user_id),
        "is_owner": True,
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
    }


@router.put("/surveys/{survey_id}")
async def update_survey(
    survey_update: SurveyConfigUpdate,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update an existing survey configuration.
    Requires owner access (or admin).
    """

    # Update fields if provided
    if survey_update.survey_name is not None:
        # Check if new name conflicts with existing survey
        existing = (
            db.query(SurveyConfig)
            .filter(
                SurveyConfig.survey_name == survey_update.survey_name,
                SurveyConfig.survey_id != survey.survey_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Survey with name '{survey_update.survey_name}' already exists",
            )
        survey.survey_name = survey_update.survey_name

    if survey_update.kobo_asset_id is not None:
        survey.kobo_asset_id = survey_update.kobo_asset_id

    if survey_update.config_data is not None:
        incoming = dict(survey_update.config_data)
        # Saved through their own endpoints: a settings page that does not
        # know about them must not wipe them by saving the rest.
        for key in OWN_ENDPOINT_KEYS:
            if key not in incoming and key in (survey.config_data or {}):
                incoming[key] = survey.config_data[key]
        survey.config_data = incoming

    survey.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(survey)

    logger.info(f"User {current_user.email} updated survey {survey.survey_id}")

    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "permission": "owner",
        "updated_at": updated_at.isoformat() if (updated_at := survey.updated_at) else None,
    }


@router.delete("/surveys/{survey_id}")
async def delete_survey(
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Delete a survey and all associated data.
    Requires owner access (or admin).

    WARNING: This will permanently delete:
    - All submissions (submissions_current and submissions_history)
    - All validation rules
    - All shared access entries
    - The survey configuration itself

    This operation cannot be undone.
    """
    survey_name = survey.survey_name

    try:
        # Step 1: Delete all submissions_current for this survey
        submissions_count = (
            db.query(SubmissionCurrent)
            .filter(SubmissionCurrent.survey_id == survey.survey_id)
            .count()
        )

        if submissions_count > 0:
            logger.info(f"Deleting {submissions_count} submissions for survey {survey.survey_id}")
            db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey.survey_id
            ).delete()

        # Step 2: Delete all validation rules for this survey
        rules_count = (
            db.query(ValidationRule).filter(ValidationRule.survey_id == survey.survey_id).count()
        )

        if rules_count > 0:
            logger.info(f"Deleting {rules_count} validation rules for survey {survey.survey_id}")
            db.query(ValidationRule).filter(ValidationRule.survey_id == survey.survey_id).delete()

        # Step 3: Delete the survey (shared_access will cascade delete)
        db.delete(survey)
        app_events.record(
            db, app_events.SURVEY_DELETED, user=current_user, survey_id=survey.survey_id
        )
        db.commit()

        logger.info(f"User {current_user.email} deleted survey {survey.survey_id} ({survey_name})")

        return {
            "message": f"Survey '{survey_name}' has been deleted successfully",
            "deleted_submissions": submissions_count,
            "deleted_validation_rules": rules_count,
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting survey {survey.survey_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete survey: {e!s}") from e


# =============================================================================
# Survey Sharing Endpoints
# =============================================================================


@router.post("/surveys/{survey_id}/ai-checks/rerun")
async def rerun_ai_checks(
    survey: OwnedSurvey,
    db: DbSession,
):
    """
    Make the next pull run every submission's AI check again.

    A pull re-queues a check when the stored rules hash no longer matches, so
    clearing it is enough. For checks recorded as successful while the AI
    provider was in fact failing -- which they were, until failures were
    stored as such -- and for any time the owner wants a fresh pass.
    Requires owner access: re-running spends AI credit.
    """

    count = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey.survey_id)
        .update({SubmissionCurrent.llm_rules_hash: None}, synchronize_session=False)
    )
    db.commit()
    logger.info("AI checks reset for %s submissions of survey %s", count, survey.survey_id)
    return {"submissions": count}


@router.get("/surveys/{survey_id}/access")
async def get_survey_access(
    survey: OwnedSurvey,
    db: DbSession,
):
    """
    Get list of users who have access to this survey.
    Requires owner access (or admin).
    """

    return get_survey_access_list(db, survey.survey_id)


@router.post("/surveys/{survey_id}/access")
async def share_survey(
    share_request: ShareSurveyRequest,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Share survey with another user by email.
    Requires owner access (or admin).
    """

    # Find user by email
    target_user = db.query(User).filter(User.email == share_request.email).first()

    if not target_user:
        raise HTTPException(
            status_code=404, detail=f"User with email '{share_request.email}' not found"
        )

    # Cannot share with yourself
    if target_user.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot share survey with yourself")

    # Cannot share with the owner
    if survey.user_id and target_user.user_id == survey.user_id:
        raise HTTPException(status_code=400, detail="This user is already the owner of the survey")

    # Grant access
    access = grant_survey_access(
        db=db,
        survey_id=survey.survey_id,
        user_id=target_user.user_id,
        permission_level=share_request.permission_level,
        granted_by=current_user.user_id,
    )
    app_events.record(
        db,
        app_events.SURVEY_SHARED,
        user=current_user,
        survey_id=survey.survey_id,
        details={"permission_level": share_request.permission_level},
    )
    db.commit()

    logger.info(
        f"User {current_user.email} shared survey {survey.survey_id} with {share_request.email} as {share_request.permission_level}"
    )

    return {
        "message": f"Survey shared with {share_request.email}",
        "user_id": str(target_user.user_id),
        "email": target_user.email,
        "username": target_user.username,
        "permission_level": access.permission_level,
        "granted_at": access.granted_at.isoformat() if access.granted_at else None,
    }


@router.put("/surveys/{survey_id}/access/{user_id}")
async def update_survey_access(
    user_id: str,
    update_request: UpdateAccessRequest,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a user's access level for a survey.
    Requires owner access (or admin).
    """
    target_user_uuid = parse_uuid(user_id, "user_id")

    # Cannot change owner's access
    if survey.user_id and target_user_uuid == survey.user_id:
        raise HTTPException(
            status_code=400, detail="Cannot modify owner's access. Transfer ownership instead."
        )

    # Update access
    access = grant_survey_access(
        db=db,
        survey_id=survey.survey_id,
        user_id=target_user_uuid,
        permission_level=update_request.permission_level,
        granted_by=current_user.user_id,
    )

    logger.info(
        f"User {current_user.email} updated access for user {user_id} on survey {survey.survey_id} to {update_request.permission_level}"
    )

    return {
        "message": "Access updated",
        "user_id": str(target_user_uuid),
        "permission_level": access.permission_level,
    }


@router.delete("/surveys/{survey_id}/access/{user_id}")
async def revoke_survey_access_endpoint(
    user_id: str,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Revoke a user's access to a survey.
    Requires owner access (or admin).
    """
    target_user_uuid = parse_uuid(user_id, "user_id")

    # Cannot revoke owner's access
    if survey.user_id and target_user_uuid == survey.user_id:
        raise HTTPException(
            status_code=400, detail="Cannot revoke owner's access. Transfer ownership instead."
        )

    # Revoke access
    revoked = revoke_survey_access(db, survey.survey_id, target_user_uuid)

    if not revoked:
        raise HTTPException(
            status_code=404, detail="User does not have shared access to this survey"
        )

    logger.info(
        f"User {current_user.email} revoked access for user {user_id} on survey {survey.survey_id}"
    )

    return {"message": "Access revoked", "user_id": str(target_user_uuid)}

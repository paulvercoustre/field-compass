"""
Survey configuration API endpoints.
Provides access to survey configurations with permission-based access control.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from uuid import UUID
from pydantic import BaseModel, Field, EmailStr
from datetime import datetime

from services.database import get_db
from services.auth import get_current_active_user
from services.permissions import (
    get_accessible_surveys,
    get_user_permission,
    require_survey_access,
    grant_survey_access,
    revoke_survey_access,
    get_survey_access_list,
)
from database.models import SurveyConfig, SubmissionCurrent, ValidationRule, User
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Pydantic Models
# =============================================================================

class SurveyConfigUpdate(BaseModel):
    survey_name: Optional[str] = None
    kobo_asset_id: Optional[str] = None
    config_data: Optional[Dict[str, Any]] = None


class SurveyCreate(BaseModel):
    survey_name: str = Field(..., min_length=1, max_length=255)
    kobo_asset_id: Optional[str] = None
    config_data: Dict[str, Any] = Field(default_factory=dict)


class ShareSurveyRequest(BaseModel):
    email: EmailStr
    permission_level: str = Field(..., pattern="^(editor|viewer)$")


class UpdateAccessRequest(BaseModel):
    permission_level: str = Field(..., pattern="^(editor|viewer)$")


# =============================================================================
# Survey CRUD Endpoints
# =============================================================================

@router.get("/surveys")
async def get_surveys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
        result.append({
            "survey_id": str(survey.survey_id),
            "survey_name": survey.survey_name,
            "kobo_asset_id": survey.kobo_asset_id,
            "permission": permission,
            "owner_id": str(survey.user_id) if survey.user_id else None,
            "is_owner": survey.user_id == current_user.user_id,
        })
    
    return result


@router.get("/surveys/{survey_id}")
async def get_survey(
    survey_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get a specific survey by ID with full configuration.
    Requires at least viewer access.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Check access and get survey
    survey = require_survey_access(db, current_user, survey_uuid, min_level='viewer')
    permission = get_user_permission(db, current_user, survey_uuid)
    
    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "permission": permission,
        "owner_id": str(survey.user_id) if survey.user_id else None,
        "is_owner": survey.user_id == current_user.user_id,
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
        "updated_at": survey.updated_at.isoformat() if survey.updated_at else None,
    }


@router.post("/surveys", status_code=201)
async def create_survey(
    survey_data: SurveyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create a new survey configuration.
    The current user becomes the owner of the survey.
    """
    # Check if survey name already exists
    existing = db.query(SurveyConfig).filter(
        SurveyConfig.survey_name == survey_data.survey_name
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Survey with name '{survey_data.survey_name}' already exists"
        )
    
    # Create new survey with current user as owner
    survey = SurveyConfig(
        survey_name=survey_data.survey_name,
        kobo_asset_id=survey_data.kobo_asset_id,
        config_data=survey_data.config_data,
        user_id=current_user.user_id  # Set owner
    )
    
    db.add(survey)
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
    survey_id: str,
    survey_update: SurveyConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update an existing survey configuration.
    Requires owner access (or admin).
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Require owner access to update survey config
    survey = require_survey_access(db, current_user, survey_uuid, min_level='owner')
    
    # Update fields if provided
    if survey_update.survey_name is not None:
        # Check if new name conflicts with existing survey
        existing = db.query(SurveyConfig).filter(
            SurveyConfig.survey_name == survey_update.survey_name,
            SurveyConfig.survey_id != survey_uuid
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Survey with name '{survey_update.survey_name}' already exists"
            )
        survey.survey_name = survey_update.survey_name
    
    if survey_update.kobo_asset_id is not None:
        survey.kobo_asset_id = survey_update.kobo_asset_id
    
    if survey_update.config_data is not None:
        survey.config_data = survey_update.config_data
    
    survey.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(survey)
    
    logger.info(f"User {current_user.email} updated survey {survey_id}")
    
    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "permission": "owner",
        "updated_at": survey.updated_at.isoformat() if survey.updated_at else None,
    }


@router.delete("/surveys/{survey_id}")
async def delete_survey(
    survey_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Require owner access to delete
    survey = require_survey_access(db, current_user, survey_uuid, min_level='owner')
    survey_name = survey.survey_name
    
    try:
        # Step 1: Delete all submissions_current for this survey
        submissions_count = db.query(SubmissionCurrent).filter(
            SubmissionCurrent.survey_id == survey_uuid
        ).count()
        
        if submissions_count > 0:
            logger.info(f"Deleting {submissions_count} submissions for survey {survey_id}")
            db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey_uuid
            ).delete()
        
        # Step 2: Delete all validation rules for this survey
        rules_count = db.query(ValidationRule).filter(
            ValidationRule.survey_id == survey_uuid
        ).count()
        
        if rules_count > 0:
            logger.info(f"Deleting {rules_count} validation rules for survey {survey_id}")
            db.query(ValidationRule).filter(
                ValidationRule.survey_id == survey_uuid
            ).delete()
        
        # Step 3: Delete the survey (shared_access will cascade delete)
        db.delete(survey)
        db.commit()
        
        logger.info(f"User {current_user.email} deleted survey {survey_id} ({survey_name})")
        
        return {
            "message": f"Survey '{survey_name}' has been deleted successfully",
            "deleted_submissions": submissions_count,
            "deleted_validation_rules": rules_count
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting survey {survey_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete survey: {str(e)}"
        )


# =============================================================================
# Survey Sharing Endpoints
# =============================================================================

@router.get("/surveys/{survey_id}/access")
async def get_survey_access(
    survey_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get list of users who have access to this survey.
    Requires owner access (or admin).
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Require owner access to view sharing settings
    require_survey_access(db, current_user, survey_uuid, min_level='owner')
    
    return get_survey_access_list(db, survey_uuid)


@router.post("/surveys/{survey_id}/access")
async def share_survey(
    survey_id: str,
    share_request: ShareSurveyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Share survey with another user by email.
    Requires owner access (or admin).
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Require owner access to share
    survey = require_survey_access(db, current_user, survey_uuid, min_level='owner')
    
    # Find user by email
    target_user = db.query(User).filter(User.email == share_request.email).first()
    
    if not target_user:
        raise HTTPException(
            status_code=404,
            detail=f"User with email '{share_request.email}' not found"
        )
    
    # Cannot share with yourself
    if target_user.user_id == current_user.user_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot share survey with yourself"
        )
    
    # Cannot share with the owner
    if survey.user_id and target_user.user_id == survey.user_id:
        raise HTTPException(
            status_code=400,
            detail="This user is already the owner of the survey"
        )
    
    # Grant access
    access = grant_survey_access(
        db=db,
        survey_id=survey_uuid,
        user_id=target_user.user_id,
        permission_level=share_request.permission_level,
        granted_by=current_user.user_id
    )
    
    logger.info(f"User {current_user.email} shared survey {survey_id} with {share_request.email} as {share_request.permission_level}")
    
    return {
        "message": f"Survey shared with {share_request.email}",
        "user_id": str(target_user.user_id),
        "email": target_user.email,
        "username": target_user.username,
        "permission_level": access.permission_level,
        "granted_at": access.granted_at.isoformat() if access.granted_at else None
    }


@router.put("/surveys/{survey_id}/access/{user_id}")
async def update_survey_access(
    survey_id: str,
    user_id: str,
    update_request: UpdateAccessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update a user's access level for a survey.
    Requires owner access (or admin).
    """
    try:
        survey_uuid = UUID(survey_id)
        target_user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid UUID format"
        )
    
    # Require owner access
    survey = require_survey_access(db, current_user, survey_uuid, min_level='owner')
    
    # Cannot change owner's access
    if survey.user_id and target_user_uuid == survey.user_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot modify owner's access. Transfer ownership instead."
        )
    
    # Update access
    access = grant_survey_access(
        db=db,
        survey_id=survey_uuid,
        user_id=target_user_uuid,
        permission_level=update_request.permission_level,
        granted_by=current_user.user_id
    )
    
    logger.info(f"User {current_user.email} updated access for user {user_id} on survey {survey_id} to {update_request.permission_level}")
    
    return {
        "message": "Access updated",
        "user_id": str(target_user_uuid),
        "permission_level": access.permission_level
    }


@router.delete("/surveys/{survey_id}/access/{user_id}")
async def revoke_survey_access_endpoint(
    survey_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Revoke a user's access to a survey.
    Requires owner access (or admin).
    """
    try:
        survey_uuid = UUID(survey_id)
        target_user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid UUID format"
        )
    
    # Require owner access
    survey = require_survey_access(db, current_user, survey_uuid, min_level='owner')
    
    # Cannot revoke owner's access
    if survey.user_id and target_user_uuid == survey.user_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot revoke owner's access. Transfer ownership instead."
        )
    
    # Revoke access
    revoked = revoke_survey_access(db, survey_uuid, target_user_uuid)
    
    if not revoked:
        raise HTTPException(
            status_code=404,
            detail="User does not have shared access to this survey"
        )
    
    logger.info(f"User {current_user.email} revoked access for user {user_id} on survey {survey_id}")
    
    return {
        "message": "Access revoked",
        "user_id": str(target_user_uuid)
    }

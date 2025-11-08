"""
Survey configuration API endpoints.
Provides access to survey configurations.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime

from services.database import get_db
from database.models import SurveyConfig

router = APIRouter()


class SurveyConfigUpdate(BaseModel):
    survey_name: Optional[str] = None
    kobo_asset_id: Optional[str] = None
    config_data: Optional[Dict[str, Any]] = None


class SurveyCreate(BaseModel):
    survey_name: str = Field(..., min_length=1, max_length=255)
    kobo_asset_id: Optional[str] = None
    config_data: Dict[str, Any]


@router.get("/surveys")
async def get_surveys(
    db: Session = Depends(get_db),
):
    """
    Get list of all surveys.
    Returns basic survey information including survey_id and survey_name.
    """
    surveys = db.query(SurveyConfig).all()
    
    return [
        {
            "survey_id": str(survey.survey_id),
            "survey_name": survey.survey_name,
            "kobo_asset_id": survey.kobo_asset_id,
        }
        for survey in surveys
    ]


@router.get("/surveys/{survey_id}")
async def get_survey(
    survey_id: str,
    db: Session = Depends(get_db),
):
    """
    Get a specific survey by ID with full configuration.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
    
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")
    
    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
        "updated_at": survey.updated_at.isoformat() if survey.updated_at else None,
    }


@router.post("/surveys", status_code=201)
async def create_survey(
    survey_data: SurveyCreate,
    db: Session = Depends(get_db),
):
    """
    Create a new survey configuration.
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
    
    # Create new survey
    survey = SurveyConfig(
        survey_name=survey_data.survey_name,
        kobo_asset_id=survey_data.kobo_asset_id,
        config_data=survey_data.config_data
    )
    
    db.add(survey)
    db.commit()
    db.refresh(survey)
    
    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
    }


@router.put("/surveys/{survey_id}")
async def update_survey(
    survey_id: str,
    survey_update: SurveyConfigUpdate,
    db: Session = Depends(get_db),
):
    """
    Update an existing survey configuration.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
    
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")
    
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
    
    return {
        "survey_id": str(survey.survey_id),
        "survey_name": survey.survey_name,
        "kobo_asset_id": survey.kobo_asset_id,
        "config_data": survey.config_data,
        "updated_at": survey.updated_at.isoformat() if survey.updated_at else None,
    }


@router.delete("/surveys/{survey_id}")
async def delete_survey(
    survey_id: str,
    db: Session = Depends(get_db),
):
    """
    Delete a survey and all associated data.
    WARNING: This will permanently delete the survey configuration and all related data.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
    
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")
    
    # TODO: In the future, we may want to cascade delete related data (submissions, validation rules, etc.)
    # For now, we'll just delete the survey config
    # Note: If there are foreign key constraints, we may need to delete related records first
    
    db.delete(survey)
    db.commit()
    
    return {"message": f"Survey '{survey.survey_name}' has been deleted successfully"}


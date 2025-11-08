"""
Validation rules API endpoints.
Provides CRUD operations for validation rules.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from uuid import UUID
from pydantic import BaseModel, Field

from services.database import get_db
from database.models import ValidationRule, SurveyConfig

router = APIRouter()


class ValidationRuleCreate(BaseModel):
    rule_name: str = Field(..., min_length=1, max_length=255)
    rule_data: Dict[str, Any]
    is_active: bool = True


class ValidationRuleUpdate(BaseModel):
    rule_name: Optional[str] = Field(None, min_length=1, max_length=255)
    rule_data: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class ValidationRuleResponse(BaseModel):
    rule_id: str
    survey_id: str
    rule_name: str
    rule_data: Dict[str, Any]
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@router.get("/surveys/{survey_id}/rules", response_model=List[ValidationRuleResponse])
async def get_validation_rules(
    survey_id: str,
    db: Session = Depends(get_db),
):
    """
    Get all validation rules for a survey.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Verify survey exists
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")
    
    rules = db.query(ValidationRule).filter(ValidationRule.survey_id == survey_uuid).all()
    
    return [
        {
            "rule_id": str(rule.rule_id),
            "survey_id": str(rule.survey_id),
            "rule_name": rule.rule_name,
            "rule_data": rule.rule_data,
            "is_active": rule.is_active,
            "created_at": rule.created_at.isoformat() if rule.created_at else None,
            "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        }
        for rule in rules
    ]


@router.get("/surveys/{survey_id}/rules/{rule_id}", response_model=ValidationRuleResponse)
async def get_validation_rule(
    survey_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
):
    """
    Get a specific validation rule by ID.
    """
    try:
        survey_uuid = UUID(survey_id)
        rule_uuid = UUID(rule_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid UUID format"
        )
    
    rule = db.query(ValidationRule).filter(
        ValidationRule.rule_id == rule_uuid,
        ValidationRule.survey_id == survey_uuid
    ).first()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")
    
    return {
        "rule_id": str(rule.rule_id),
        "survey_id": str(rule.survey_id),
        "rule_name": rule.rule_name,
        "rule_data": rule.rule_data,
        "is_active": rule.is_active,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


@router.post("/surveys/{survey_id}/rules", status_code=201, response_model=ValidationRuleResponse)
async def create_validation_rule(
    survey_id: str,
    rule_data: ValidationRuleCreate,
    db: Session = Depends(get_db),
):
    """
    Create a new validation rule for a survey.
    """
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Verify survey exists
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")
    
    # Check if rule name already exists for this survey
    existing = db.query(ValidationRule).filter(
        ValidationRule.survey_id == survey_uuid,
        ValidationRule.rule_name == rule_data.rule_name
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Rule with name '{rule_data.rule_name}' already exists for this survey"
        )
    
    # Create new rule
    rule = ValidationRule(
        survey_id=survey_uuid,
        rule_name=rule_data.rule_name,
        rule_data=rule_data.rule_data,
        is_active=rule_data.is_active
    )
    
    db.add(rule)
    db.commit()
    db.refresh(rule)
    
    return {
        "rule_id": str(rule.rule_id),
        "survey_id": str(rule.survey_id),
        "rule_name": rule.rule_name,
        "rule_data": rule.rule_data,
        "is_active": rule.is_active,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


@router.put("/surveys/{survey_id}/rules/{rule_id}", response_model=ValidationRuleResponse)
async def update_validation_rule(
    survey_id: str,
    rule_id: str,
    rule_update: ValidationRuleUpdate,
    db: Session = Depends(get_db),
):
    """
    Update an existing validation rule.
    """
    try:
        survey_uuid = UUID(survey_id)
        rule_uuid = UUID(rule_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid UUID format"
        )
    
    rule = db.query(ValidationRule).filter(
        ValidationRule.rule_id == rule_uuid,
        ValidationRule.survey_id == survey_uuid
    ).first()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")
    
    # Update fields if provided
    if rule_update.rule_name is not None:
        # Check if new name conflicts with existing rule
        existing = db.query(ValidationRule).filter(
            ValidationRule.survey_id == survey_uuid,
            ValidationRule.rule_name == rule_update.rule_name,
            ValidationRule.rule_id != rule_uuid
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Rule with name '{rule_update.rule_name}' already exists for this survey"
            )
        rule.rule_name = rule_update.rule_name
    
    if rule_update.rule_data is not None:
        rule.rule_data = rule_update.rule_data
    
    if rule_update.is_active is not None:
        rule.is_active = rule_update.is_active
    
    db.commit()
    db.refresh(rule)
    
    return {
        "rule_id": str(rule.rule_id),
        "survey_id": str(rule.survey_id),
        "rule_name": rule.rule_name,
        "rule_data": rule.rule_data,
        "is_active": rule.is_active,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


@router.delete("/surveys/{survey_id}/rules/{rule_id}")
async def delete_validation_rule(
    survey_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
):
    """
    Delete a validation rule.
    """
    try:
        survey_uuid = UUID(survey_id)
        rule_uuid = UUID(rule_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid UUID format"
        )
    
    rule = db.query(ValidationRule).filter(
        ValidationRule.rule_id == rule_uuid,
        ValidationRule.survey_id == survey_uuid
    ).first()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")
    
    rule_name = rule.rule_name
    db.delete(rule)
    db.commit()
    
    return {"message": f"Validation rule '{rule_name}' has been deleted successfully"}


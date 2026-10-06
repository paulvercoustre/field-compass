"""
Validation rules API endpoints.
Provides CRUD operations for validation rules with permission checks.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database.models import ValidationRule
from services.database import DbSession
from services.permissions import OwnedSurvey, ViewableSurvey, parse_uuid

router = APIRouter()


class ValidationRuleCreateModel(BaseModel):
    rule_name: str = Field(..., min_length=1, max_length=255)
    rule_data: dict[str, Any]
    is_active: bool = True


class ValidationRuleUpdateModel(BaseModel):
    rule_name: str | None = Field(default=None, min_length=1, max_length=255)
    rule_data: dict[str, Any] | None = None
    is_active: bool | None = None


class ValidationRuleResponse(BaseModel):
    rule_id: str
    survey_id: str
    rule_name: str
    rule_data: dict[str, Any]
    is_active: bool
    created_at: str | None = None
    updated_at: str | None = None


@router.get("/surveys/{survey_id}/rules", response_model=list[ValidationRuleResponse])
async def get_validation_rules(
    survey: ViewableSurvey,
    db: DbSession,
):
    """
    Get all validation rules for a survey.
    Requires viewer access to the survey.
    """

    rules = db.query(ValidationRule).filter(ValidationRule.survey_id == survey.survey_id).all()

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
    rule_id: str,
    survey: ViewableSurvey,
    db: DbSession,
):
    """
    Get a specific validation rule by ID.
    Requires viewer access to the survey.
    """
    rule_uuid = parse_uuid(rule_id, "rule_id")

    rule = (
        db.query(ValidationRule)
        .filter(ValidationRule.rule_id == rule_uuid, ValidationRule.survey_id == survey.survey_id)
        .first()
    )

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
    rule_data: ValidationRuleCreateModel,
    survey: OwnedSurvey,
    db: DbSession,
):
    """
    Create a new validation rule for a survey.
    Requires owner access to the survey (only owners can configure HFC rules).
    """

    # Check if rule name already exists for this survey
    existing = (
        db.query(ValidationRule)
        .filter(
            ValidationRule.survey_id == survey.survey_id,
            ValidationRule.rule_name == rule_data.rule_name,
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Rule with name '{rule_data.rule_name}' already exists for this survey",
        )

    # Create new rule
    rule = ValidationRule(
        survey_id=survey.survey_id,
        rule_name=rule_data.rule_name,
        rule_data=rule_data.rule_data,
        is_active=rule_data.is_active,
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
    rule_id: str,
    rule_update: ValidationRuleUpdateModel,
    survey: OwnedSurvey,
    db: DbSession,
):
    """
    Update an existing validation rule.
    Requires owner access to the survey (only owners can configure HFC rules).
    """
    rule_uuid = parse_uuid(rule_id, "rule_id")

    rule = (
        db.query(ValidationRule)
        .filter(ValidationRule.rule_id == rule_uuid, ValidationRule.survey_id == survey.survey_id)
        .first()
    )

    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")

    # Update fields if provided
    if rule_update.rule_name is not None:
        # Check if new name conflicts with existing rule
        existing = (
            db.query(ValidationRule)
            .filter(
                ValidationRule.survey_id == survey.survey_id,
                ValidationRule.rule_name == rule_update.rule_name,
                ValidationRule.rule_id != rule_uuid,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Rule with name '{rule_update.rule_name}' already exists for this survey",
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
    rule_id: str,
    survey: OwnedSurvey,
    db: DbSession,
):
    """
    Delete a validation rule.
    Requires owner access to the survey (only owners can configure HFC rules).
    """
    rule_uuid = parse_uuid(rule_id, "rule_id")

    rule = (
        db.query(ValidationRule)
        .filter(ValidationRule.rule_id == rule_uuid, ValidationRule.survey_id == survey.survey_id)
        .first()
    )

    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")

    rule_name = rule.rule_name
    db.delete(rule)
    db.commit()

    return {"message": f"Validation rule '{rule_name}' has been deleted successfully"}

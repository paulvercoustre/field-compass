"""
Form linter.

Every check is a pure function of the form schema: no model, no network, and
no respondent data.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.models import User, ValidationRule
from forms.schema import FormSchema
from linter.adopt import adopt_findings, select_findings
from linter.engine import run_lint
from linter.form_source import schema_from_payload, schema_from_survey
from linter.models import LintContext
from services.auth import get_current_active_user
from services.database import get_db
from services.permissions import require_survey_access

router = APIRouter()


class LintFormRequest(BaseModel):
    form: dict[str, Any] = Field(..., description="kobo_tool, asset content, or asset payload")
    enabled_checks: list[str] | None = None


class AdoptItem(BaseModel):
    check_id: str
    question_path: str | None = None


class AdoptRulesRequest(BaseModel):
    items: list[AdoptItem]
    is_active: bool = True


def _parse_survey_id(survey_id: str) -> UUID:
    try:
        return UUID(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID.",
        )


def _require_form(schema: FormSchema) -> FormSchema:
    if schema.is_empty:
        raise HTTPException(
            status_code=400,
            detail=(
                "This survey has no form yet. Read the form from the Kobo project "
                "first, then run the linter."
            ),
        )
    return schema


def _rule_payload(rule: ValidationRule, *, created: bool) -> dict[str, Any]:
    return {
        "rule_id": str(rule.rule_id),
        "rule_name": rule.rule_name,
        "rule_data": rule.rule_data,
        "is_active": rule.is_active,
        "created": created,
    }


@router.post("/lint")
async def lint_form_payload(
    payload: LintFormRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Lint a form that is not (yet) attached to a survey — the create-survey path."""
    del current_user
    schema = _require_form(schema_from_payload(payload.form))
    return run_lint(schema, enabled_checks=payload.enabled_checks).as_dict()


@router.get("/surveys/{survey_id}/lint")
async def lint_survey(
    survey_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Lint the form stored on this survey. Viewer access."""
    survey_uuid = _parse_survey_id(survey_id)
    survey = require_survey_access(db, current_user, survey_uuid, min_level="viewer")
    schema = _require_form(schema_from_survey(survey))
    return run_lint(schema, ctx=LintContext(config_data=survey.config_data)).as_dict()


@router.post("/surveys/{survey_id}/lint/adopt-rules")
async def adopt_lint_rules(
    survey_id: str,
    payload: AdoptRulesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create HFC rules from selected lint findings. Editor access.

    Idempotent: adopting the same finding twice returns the existing rule.
    Findings without a runtime twin (no auto_rule) are skipped.
    """
    survey_uuid = _parse_survey_id(survey_id)
    survey = require_survey_access(db, current_user, survey_uuid, min_level="editor")
    schema = _require_form(schema_from_survey(survey))
    report = run_lint(schema)
    selected = select_findings(
        report,
        [
            {"check_id": item.check_id, "question_path": item.question_path}
            for item in payload.items
        ],
    )
    existing_names = {
        rule.rule_name
        for rule in db.query(ValidationRule).filter(ValidationRule.survey_id == survey_uuid).all()
    }
    rules = adopt_findings(db, survey_uuid, selected, is_active=payload.is_active)
    return [_rule_payload(rule, created=rule.rule_name not in existing_names) for rule in rules]

"""
Form linter and cognitive pretest.

The linter is deterministic and schema-only. The pretest adds an optional
agent walk of the same form; that path is schema-only too (no respondent data).
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.models import SurveyConfig, User, ValidationRule
from etl.kobo_fetcher import KoboFetcher
from forms.schema import FormSchema
from linter.adopt import adopt_findings, select_findings
from linter.engine import run_lint
from linter.form_source import SurveyForm, load_survey_form, schema_from_payload
from linter.models import LintContext
from linter.pretest import run_pretest
from services.ai_service import ai_service
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.permissions import require_survey_access
from services.rate_limit import limiter

router = APIRouter()


class LintFormRequest(BaseModel):
    form: dict[str, Any] = Field(..., description="kobo_tool, asset content, or asset payload")
    enabled_checks: list[str] | None = None


class PretestFormRequest(BaseModel):
    form: dict[str, Any]
    use_agent: bool = True


class SurveyPretestRequest(BaseModel):
    use_agent: bool = True


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


def _survey_form(survey: SurveyConfig, current_user: User) -> SurveyForm:
    """
    The survey's form, re-read from Kobo when the stored copy has no logic.

    Surveys linked to Kobo before the linter were stored without constraints,
    skip logic, or required flags. Linting that copy would flag every question,
    so read the live form with the caller's own Kobo key; without one, the
    report says the logic is missing and the checks that need it are skipped.
    """
    token = get_user_kobo_token(current_user)
    fetch_live = None
    if token:
        api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"

        def fetch_live(asset_uid: str) -> Any:
            return KoboFetcher(api_token=token, api_url=api_url).get_asset_info(asset_uid)

    survey_form = load_survey_form(survey, fetch_live)
    _require_form(survey_form.schema)
    return survey_form


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
    survey_form = _survey_form(survey, current_user)
    return run_lint(
        survey_form.schema,
        ctx=LintContext(config_data=survey.config_data),
        form_logic_missing=survey_form.logic_missing,
    ).as_dict()


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
    survey_form = _survey_form(survey, current_user)
    report = run_lint(survey_form.schema, form_logic_missing=survey_form.logic_missing)
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


@router.post("/pretest")
@limiter.limit("10/hour")
async def pretest_form_payload(
    request: Request,
    payload: PretestFormRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Cognitive pretest of a form that is not (yet) a survey."""
    del request, current_user
    schema = _require_form(schema_from_payload(payload.form))
    report = run_pretest(schema, use_agent=payload.use_agent, agent=ai_service)
    return report.as_dict()


@router.post("/surveys/{survey_id}/pretest")
@limiter.limit("10/hour")
async def pretest_survey(
    request: Request,
    survey_id: str,
    payload: SurveyPretestRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Cognitive pretest of the form stored on this survey. Viewer access."""
    del request
    survey_uuid = _parse_survey_id(survey_id)
    survey = require_survey_access(db, current_user, survey_uuid, min_level="viewer")
    survey_form = _survey_form(survey, current_user)
    use_agent = True if payload is None else payload.use_agent
    report = run_pretest(
        survey_form.schema,
        use_agent=use_agent,
        agent=ai_service,
        form_logic_missing=survey_form.logic_missing,
    )
    return report.as_dict()

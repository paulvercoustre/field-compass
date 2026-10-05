"""
Form linter.

Every check is a pure function of the form schema: no model, no network, and
no respondent data.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.models import SurveyConfig, User, ValidationRule
from etl.kobo_fetcher import KoboFetcher
from forms.schema import FormSchema
from linter.adopt import adopt_findings, select_findings
from linter.dk import dont_know_codes
from linter.engine import run_lint
from linter.form_source import SurveyForm, load_survey_form, schema_from_payload
from linter.models import LintContext, language_from_label_column
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.permissions import survey_access

router = APIRouter()

# The endpoints are plain `def`: linting, and the Kobo fetch an old stored
# form needs, are synchronous, and FastAPI runs `def` endpoints in a thread
# pool. As `async def` they ran on the event loop and stalled every other
# request until the check finished.


class LintFormRequest(BaseModel):
    form: dict[str, Any] = Field(..., description="kobo_tool, asset content, or asset payload")
    enabled_checks: list[str] | None = None
    label_column: str | None = Field(
        default=None, description="Label language as a sheet column, e.g. `label::French (fr)`"
    )


class DkValuesRequest(BaseModel):
    form: dict[str, Any] = Field(..., description="kobo_tool: survey rows and choices")


class AdoptItem(BaseModel):
    check_id: str
    question_path: str | None = None


class AdoptRulesRequest(BaseModel):
    items: list[AdoptItem]
    is_active: bool = True
    label_column: str | None = None


def _survey_language(survey: SurveyConfig, label_column: str | None) -> str | None:
    """The label language the screen asked for, else the survey's saved one."""
    saved = ((survey.config_data or {}).get("kobo_tool") or {}).get("label_column_survey")
    return language_from_label_column(label_column) or language_from_label_column(saved)


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
def lint_form_payload(
    payload: LintFormRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Lint a form that is not (yet) attached to a survey — the create-survey path."""
    del current_user
    schema = _require_form(schema_from_payload(payload.form))
    return run_lint(
        schema,
        enabled_checks=payload.enabled_checks,
        ctx=LintContext(language=language_from_label_column(payload.label_column)),
    ).as_dict()


@router.post("/lint/dk-values")
def dk_values_for_form(
    payload: DkValuesRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    The form's don't-know codes, found the way the linter finds them.

    The survey screens pre-fill "Don't know — answer options" from this, so a
    code the linter reports is one the configuration counts.
    """
    del current_user
    schema = schema_from_payload(payload.form)
    return {
        "values": [
            {"name": code.name, "label": code.label, "lists": list(code.lists)}
            for code in dont_know_codes(schema)
        ]
    }


@router.get("/surveys/{survey_id}/lint")
def lint_survey(
    survey: SurveyConfig = Depends(survey_access("viewer")),
    label_column: str | None = None,
    current_user: User = Depends(get_current_active_user),
):
    """Lint the form stored on this survey. Viewer access."""
    survey_form = _survey_form(survey, current_user)
    return run_lint(
        survey_form.schema,
        ctx=LintContext(
            config_data=survey.config_data,
            language=_survey_language(survey, label_column),
        ),
        form_logic_missing=survey_form.logic_missing,
    ).as_dict()


@router.post("/surveys/{survey_id}/lint/adopt-rules")
def adopt_lint_rules(
    payload: AdoptRulesRequest,
    survey: SurveyConfig = Depends(survey_access("editor")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create HFC rules from selected lint findings. Editor access.

    Idempotent: adopting the same finding twice returns the existing rule.
    Findings without a runtime twin (no auto_rule) are skipped.
    """
    survey_form = _survey_form(survey, current_user)
    # Same language as the findings the user saw, so an adopted rule's issue
    # text quotes the label they read.
    report = run_lint(
        survey_form.schema,
        ctx=LintContext(language=_survey_language(survey, payload.label_column)),
        form_logic_missing=survey_form.logic_missing,
    )
    selected = select_findings(
        report,
        [
            {"check_id": item.check_id, "question_path": item.question_path}
            for item in payload.items
        ],
    )
    existing_names = {
        rule.rule_name
        for rule in db.query(ValidationRule)
        .filter(ValidationRule.survey_id == survey.survey_id)
        .all()
    }
    rules = adopt_findings(db, survey.survey_id, selected, is_active=payload.is_active)
    return [_rule_payload(rule, created=rule.rule_name not in existing_names) for rule in rules]

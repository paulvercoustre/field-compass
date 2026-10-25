"""
Form linter.

Every check is a pure function of the form schema: no model, no network, and
no respondent data.
"""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database.models import SurveyConfig, User, ValidationRule
from etl.kobo_fetcher import KoboFetcher
from forms.schema import FormSchema
from linter.adopt import adopt_findings, select_findings
from linter.dk import dont_know_codes
from linter.engine import run_lint
from linter.form_source import SurveyForm, load_survey_form, schema_from_payload
from linter.models import LintContext, language_from_label_column, survey_label_language
from services import app_events
from services.auth import CurrentUser, get_user_kobo_token
from services.database import DbSession
from services.kobo_servers import on_survey_server, survey_server
from services.permissions import EditableSurvey, ViewableSurvey

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


def _survey_language(
    survey: SurveyConfig, label_column: str | None, schema: FormSchema
) -> str | None:
    """The label language the screen asked for, else the one the survey's screens show."""
    return language_from_label_column(label_column) or survey_label_language(
        survey.config_data, schema.languages
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
    fetch_live: Callable[[str], Any] | None = None
    # The survey's own server, with the caller's key when their account is on it.
    if token and on_survey_server(survey, current_user):
        fetch_live = KoboFetcher(api_token=token, api_url=survey_server(survey)).get_asset_info

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
    current_user: CurrentUser,
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
    current_user: CurrentUser,
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
    survey: ViewableSurvey,
    current_user: CurrentUser,
    label_column: str | None = None,
):
    """Lint the form stored on this survey. Viewer access."""
    survey_form = _survey_form(survey, current_user)
    return run_lint(
        survey_form.schema,
        ctx=LintContext(
            config_data=survey.config_data,
            language=_survey_language(survey, label_column, survey_form.schema),
        ),
        form_logic_missing=survey_form.logic_missing,
    ).as_dict()


@router.post("/surveys/{survey_id}/lint/adopt-rules")
def adopt_lint_rules(
    payload: AdoptRulesRequest,
    survey: EditableSurvey,
    db: DbSession,
    current_user: CurrentUser,
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
        ctx=LintContext(
            language=_survey_language(survey, payload.label_column, survey_form.schema)
        ),
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
    app_events.record_checks_on(db, current_user, survey)
    db.commit()
    return [_rule_payload(rule, created=rule.rule_name not in existing_names) for rule in rules]

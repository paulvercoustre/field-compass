"""
Kobo project endpoints that are not tied to an existing survey.

Survey creation needs the form before a survey row exists, so these are keyed
on the Kobo asset UID rather than a survey_id. The browser cannot call Kobo
itself -- the API token is encrypted server-side and never leaves the backend
-- so the fetch has to happen here.
"""

import logging
import re

from fastapi import APIRouter, HTTPException, Request

from etl.kobo_fetcher import KoboFetcher
from forms import load_form_schema
from forms.schema import GROUP_OPEN_TYPES
from linter.questions import enclosing_relevants
from schemas import FormChoice, FormQuestion, KoboProject, SurveyFormResponse
from services.auth import CurrentUser, get_user_kobo_token
from services.database import DbSession
from services.permissions import get_accessible_surveys
from services.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Kobo asset UIDs are an "a" followed by base62. Validated rather than trusted
# because the value is interpolated into the upstream request path.
ASSET_UID_PATTERN = re.compile(r"^a[A-Za-z0-9]{6,40}$")

# Order of the picker's groups: projects collecting data first.
PROJECT_STATUS_ORDER = {"deployed": 0, "draft": 1, "archived": 2}


def _project_status(asset: dict) -> str:
    """Kobo's own deployment status, derived from older fields when it is absent."""
    status = asset.get("deployment_status")
    if status in PROJECT_STATUS_ORDER:
        return status
    if not asset.get("has_deployment"):
        return "draft"
    return "deployed" if asset.get("deployment__active") else "archived"


@router.get("/kobo/assets", response_model=list[KoboProject])
@limiter.limit("30/minute")
async def list_kobo_projects(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    The survey projects in the user's Kobo account, for picking one by name.

    Saves the user finding the project in Kobo and copying its link across.
    """
    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400,
            detail="Add your Kobo API key in your account settings to see your Kobo projects.",
        )

    api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    try:
        assets = KoboFetcher(api_token=kobo_token, api_url=api_url).list_survey_assets()
    except Exception as exc:  # any upstream failure becomes a message
        logger.warning("Kobo project list failed for user %s: %s", current_user.user_id, exc)
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (401, 403):
            detail = (
                "Kobo did not accept your API key. Check it in your account settings, "
                "or paste a project link instead."
            )
        else:
            detail = "Could not load your projects from Kobo. Try again, or paste a project link instead."
        raise HTTPException(status_code=502, detail=detail) from exc

    existing = {
        survey.kobo_asset_id: survey.survey_name
        for survey in get_accessible_surveys(db, current_user)
        if survey.kobo_asset_id
    }

    projects = [
        KoboProject(
            uid=asset["uid"],
            name=asset.get("name") or asset["uid"],
            status=_project_status(asset),
            submission_count=asset.get("deployment__submission_count"),
            owner_username=asset.get("owner__username"),
            date_modified=asset.get("date_modified"),
            existing_survey_name=existing.get(asset["uid"]),
        )
        for asset in assets
        if ASSET_UID_PATTERN.match(asset.get("uid") or "")
    ]
    # Newest first within each group: two passes, as the sort is stable.
    projects.sort(key=lambda project: project.date_modified or "", reverse=True)
    projects.sort(key=lambda project: PROJECT_STATUS_ORDER[project.status])
    return projects


@router.get("/kobo/assets/{asset_uid}/form", response_model=SurveyFormResponse)
@limiter.limit("30/minute")
async def get_kobo_asset_form(
    request: Request,
    asset_uid: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Fetch a Kobo project's form structure, normalized for configuration UIs.

    Lets a user configure a survey straight from their Kobo project instead of
    exporting the XLSForm and uploading it by hand.
    """
    if not ASSET_UID_PATTERN.match(asset_uid or ""):
        raise HTTPException(
            status_code=400,
            detail=(
                "That does not look like a Kobo project ID. Paste the link to your "
                "project in Kobo, or the project ID itself."
            ),
        )

    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400,
            detail=(
                "Add your Kobo API key in user settings so Field Compass can read your project."
            ),
        )

    api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    try:
        asset = KoboFetcher(api_token=kobo_token, api_url=api_url).get_asset_info(asset_uid)
    except Exception as exc:  # any upstream failure becomes a message
        # The upstream failure is the interesting part and belongs in the log;
        # the caller gets something they can act on.
        logger.warning("Kobo asset fetch failed for %s: %s", asset_uid, exc)
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not read that project from Kobo. Check the project ID, and that "
                "your Kobo account has access to it."
            ),
        ) from exc

    schema = load_form_schema(asset)
    if schema.is_empty:
        raise HTTPException(
            status_code=404,
            detail=(
                "That Kobo project has no form questions yet. Deploy the form in Kobo, "
                "then try again."
            ),
        )

    # A group's own label titles it in a submission's answers.
    group_labels = {
        row.path: row.label for row in schema.questions if row.type in GROUP_OPEN_TYPES and row.path
    }

    questions = [
        {
            "path": question.path,
            "name": question.name,
            "labels": question.label,
            "type": question.type,
            "list_name": question.list_name,
            "repeat_name": question.repeat_name,
            "required": question.required,
            "constraint": question.constraint,
            "relevant": question.relevant,
            "calculation": question.calculation,
            "choice_filter": (question.raw or {}).get("choice_filter") or None,
            # Group rows are dropped below, so carry what the linter needs
            # from them on each question: which groups enclose it, and the
            # conditions those groups put on it (a consent gate, usually).
            "group_path": question.group_path or None,
            "group_relevant": enclosing_relevants(schema, question),
            "group_labels": group_labels.get(question.group_path, {}),
        }
        for question in schema.questions
        # Group and repeat markers are left out: what they hold travels on each
        # question. Notes stay, to show with a submission's answers.
        if question.name and not question.is_structural
    ]

    choice_lists = {
        list_name: [{"name": c.name, "labels": c.label, "columns": c.columns()} for c in choices]
        for list_name, choices in schema.choices_by_list.items()
    }

    return SurveyFormResponse(
        asset_uid=asset_uid,
        asset_name=asset.get("name"),
        deployed_version_id=asset.get("deployed_version_id"),
        languages=schema.languages,
        has_audit=schema.has_audit,
        questions=[FormQuestion.model_validate(q) for q in questions],
        choice_lists={
            name: [FormChoice.model_validate(c) for c in choices]
            for name, choices in choice_lists.items()
        },
    )

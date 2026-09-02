"""
Kobo project endpoints that are not tied to an existing survey.

Survey creation needs the form before a survey row exists, so these are keyed
on the Kobo asset UID rather than a survey_id. The browser cannot call Kobo
itself -- the API token is encrypted server-side and never leaves the backend
-- so the fetch has to happen here.
"""

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database.models import User
from etl.kobo_fetcher import KoboFetcher
from forms import load_form_schema
from models import SurveyFormResponse
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Kobo asset UIDs are an "a" followed by base62. Validated rather than trusted
# because the value is interpolated into the upstream request path.
ASSET_UID_PATTERN = re.compile(r"^a[A-Za-z0-9]{6,40}$")

# Rows that are not answerable questions. Callers here are populating pickers,
# not rendering the form, so structural markers and notes are noise.
NON_QUESTION_TYPES = frozenset({"begin_group", "end_group", "begin_repeat", "end_repeat", "note"})


@router.get("/kobo/assets/{asset_uid}/form", response_model=SurveyFormResponse)
@limiter.limit("30/minute")
async def get_kobo_asset_form(
    request: Request,
    asset_uid: str,
    language: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
                "Add your Kobo API key in user settings so Field Compass can read " "your project."
            ),
        )

    api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    try:
        asset = KoboFetcher(api_token=kobo_token, api_url=api_url).get_asset_info(asset_uid)
    except Exception as exc:
        # The upstream failure is the interesting part and belongs in the log;
        # the caller gets something they can act on.
        logger.warning("Kobo asset fetch failed for %s: %s", asset_uid, exc)
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not read that project from Kobo. Check the project ID, and that "
                "your Kobo account has access to it."
            ),
        )

    schema = load_form_schema(asset)
    if schema.is_empty:
        raise HTTPException(
            status_code=404,
            detail=(
                "That Kobo project has no form questions yet. Deploy the form in Kobo, "
                "then try again."
            ),
        )

    questions = [
        {
            "path": question.path,
            "name": question.name,
            "label": question.label_for(language),
            "type": question.type,
            "list_name": question.list_name,
            "repeat_name": question.repeat_name,
        }
        for question in schema.questions
        if question.name and question.type not in NON_QUESTION_TYPES
    ]

    choice_lists = {
        list_name: [{"name": c.name, "label": c.label_for(language)} for c in choices]
        for list_name, choices in schema.choices_by_list.items()
    }

    return SurveyFormResponse(
        asset_uid=asset_uid,
        asset_name=asset.get("name"),
        deployed_version_id=asset.get("deployed_version_id"),
        languages=schema.languages,
        has_audit=schema.has_audit,
        questions=questions,
        choice_lists=choice_lists,
    )

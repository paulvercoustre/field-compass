"""
Submission API endpoints.
Handles CRUD operations for survey submissions with permission checks.
"""

import logging
from datetime import datetime
from uuid import UUID as UUIDType

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database.models import AI_REVIEW_OPEN, ITEM_OPEN, AudioTranscript, SubmissionCurrent, User
from database.models import SubmissionHistory as SubmissionHistoryORM
from etl.hfc_engine import HFCEngine
from etl.kobo_fetcher import KoboFetcher
from models import (
    JsonPatch,
    QualityIssue,
    ReviewerNotesUpdate,
    Submission,
    SubmissionHistory,
    SubmissionListResponse,
    ValidationStatusUpdate,
)
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.permissions import parse_uuid, require_survey_access
from services.submission_filters import filter_by_answers, parse_list, parse_sampling_filters
from services.survey_config import get_enumerator_field, get_sampling_cols

router = APIRouter()
logger = logging.getLogger(__name__)


def _orm_to_pydantic_submission(orm_submission: SubmissionCurrent) -> Submission:
    """Convert ORM model to Pydantic model."""
    # Convert JSONB quality issues to Pydantic models
    quality_issues = [QualityIssue(**issue) for issue in orm_submission.data_quality_issues or []]

    return Submission(
        # Field names; the model serializes them as Kobo's _id, _uuid, ...
        id=orm_submission._id,
        uuid=orm_submission._uuid,
        submission_time=orm_submission._submission_time,
        end=orm_submission.end,
        submission_data=orm_submission.submission_data,
        # Nullable columns with defaults; a NULL reads as the default.
        is_edited=bool(orm_submission.is_edited),
        has_edit_history=bool(orm_submission.has_edit_history),
        data_quality_issues=quality_issues,
        qa_status=orm_submission.qa_status or "PENDING_APPROVAL",
        kobo_validation_status=orm_submission.kobo_validation_status,
        kobo_edit_url=orm_submission.kobo_edit_url,
        reviewer_notes=orm_submission.reviewer_notes,
        llm_check_status=orm_submission.llm_check_status,
        llm_job_id=orm_submission.llm_job_id,
        llm_queued_at=orm_submission.llm_queued_at,
        llm_started_at=orm_submission.llm_started_at,
        llm_checked_at=orm_submission.llm_checked_at,
        llm_last_error=orm_submission.llm_last_error,
    )


def _orm_to_pydantic_history(orm_history: SubmissionHistoryORM) -> SubmissionHistory:
    """Convert ORM history model to Pydantic model."""
    # Convert JSONB data_delta to JsonPatch models
    patches = [JsonPatch(**patch) for patch in orm_history.data_delta or []]

    return SubmissionHistory(
        history_id=orm_history.history_id,
        kobo_id=orm_history.kobo_id,
        timestamp=orm_history.timestamp,
        deprecated_uuid=orm_history.deprecated_uuid,
        data_delta=patches,
    )


def _transcript_summaries(
    db: Session, survey_id: UUIDType, submission_ids: list[int]
) -> dict[int, dict[str, int]]:
    """Per submission: how many recordings were transcribed, failed, are under way, or hold no speech."""
    if not submission_ids:
        return {}
    rows = (
        db.query(AudioTranscript.submission_id, AudioTranscript.status, AudioTranscript.text)
        .filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.submission_id.in_(submission_ids),
        )
        .all()
    )
    out: dict[int, dict[str, int]] = {}
    for submission_id, status, text in rows:
        entry = out.setdefault(
            submission_id, {"count": 0, "success": 0, "failed": 0, "in_progress": 0, "no_speech": 0}
        )
        entry["count"] += 1
        if status == "success":
            entry["success"] += 1
            if not (text or "").strip():
                entry["no_speech"] += 1
        elif status == "failed":
            entry["failed"] += 1
        elif status in ITEM_OPEN:
            entry["in_progress"] += 1
    return out


@router.get("/submissions", response_model=SubmissionListResponse)
async def get_submissions(
    qa_status: str | None = Query(
        None, description="Filter by QA status (comma-separated for multiple)"
    ),
    validation_status: str | None = Query(
        None,
        description="Filter by validation status (comma-separated: Approved,Not Approved,On Hold,Not Reviewed)",
    ),
    survey_id: str | None = Query(None, description="Filter by survey ID (UUID)"),
    enumerator: str | None = Query(
        None, description="Filter by enumerator ID/value (comma-separated for multiple)"
    ),
    sampling_filters: str | None = Query(
        None,
        description="Filter by sampling variables (format: variable1=value1,value2;variable2=value3)",
    ),
    ai_review: str | None = Query(
        None, pattern="^(failed|in_progress|not_run)$", description="Filter by AI review state"
    ),
    transcript: str | None = Query(
        None,
        pattern="^(any|failed|no_speech|in_progress)$",
        description="Filter by audio transcript state",
    ),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get list of submissions with optional filtering and pagination.

    Requires authentication and access to the specified survey.

    Supports filtering by:
    - qa_status: Comma-separated QA statuses (e.g., "FLAGGED,PENDING_APPROVAL")
    - validation_status: Comma-separated validation statuses (e.g., "Approved,Not Approved,On Hold,Not Reviewed")
    - survey_id: Filter by specific survey (UUID) - REQUIRED
    - enumerator: Comma-separated enumerator IDs/values (e.g., "enum1,enum2")
    - sampling_filters: Sampling filters in format "variable1=value1,value2;variable2=value3"
      (e.g., "district=kamdesh,nangarhar;livelihood=farming,trading")

    Returns paginated results with total count.
    """
    # survey_id is required for access control
    if not survey_id:
        raise HTTPException(status_code=400, detail="survey_id is required")

    survey_uuid = parse_uuid(survey_id)
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level="viewer")

    # Build query
    query = db.query(SubmissionCurrent).filter(SubmissionCurrent.survey_id == survey_uuid)

    if qa_statuses := parse_list(qa_status):
        query = query.filter(SubmissionCurrent.qa_status.in_(qa_statuses))

    # "Not Reviewed" is a submission Kobo has no validation status for.
    if validation_statuses := parse_list(validation_status):
        reviewed = [v for v in validation_statuses if v != "Not Reviewed"]
        conditions = [SubmissionCurrent.kobo_validation_status.in_(reviewed)] if reviewed else []
        if "Not Reviewed" in validation_statuses:
            conditions.append(SubmissionCurrent.kobo_validation_status.is_(None))
        query = query.filter(or_(*conditions))

    if ai_review:
        statuses = {
            "failed": ("failed",),
            "in_progress": AI_REVIEW_OPEN,
            "not_run": ("not_run_allowance", "cancelled"),
        }[ai_review]
        query = query.filter(SubmissionCurrent.llm_check_status.in_(statuses))

    if transcript:
        transcripts = db.query(AudioTranscript.submission_id).filter(
            AudioTranscript.survey_id == survey_uuid
        )
        if transcript == "failed":
            transcripts = transcripts.filter(AudioTranscript.status == "failed")
        elif transcript == "in_progress":
            transcripts = transcripts.filter(AudioTranscript.status.in_(ITEM_OPEN))
        elif transcript == "no_speech":
            transcripts = transcripts.filter(
                AudioTranscript.status == "success",
                func.coalesce(func.trim(AudioTranscript.text), "") == "",
            )
        else:
            transcripts = transcripts.filter(AudioTranscript.status == "success")
        query = query.filter(SubmissionCurrent._id.in_(transcripts))

    # Get all submissions (we'll filter by JSONB fields in Python)
    # Note: This could be optimized with PostgreSQL JSONB queries, but filtering
    # in Python is more reliable for path-based field matching
    orm_submissions = query.order_by(SubmissionCurrent._submission_time.desc()).all()

    config = survey_config.config_data or {}
    orm_submissions = filter_by_answers(
        orm_submissions,
        enumerator_field=get_enumerator_field(config),
        enumerators=parse_list(enumerator),
        sampling_filters=parse_sampling_filters(sampling_filters),
        sampling_cols=get_sampling_cols(config),
    )

    # Get total count after JSONB filtering
    total = len(orm_submissions)

    # Apply pagination
    offset = (page - 1) * page_size
    paginated_submissions = orm_submissions[offset : offset + page_size]

    # Convert to Pydantic models
    summaries = _transcript_summaries(db, survey_uuid, [sub._id for sub in paginated_submissions])
    submissions = []
    for sub in paginated_submissions:
        item = _orm_to_pydantic_submission(sub)
        item.transcript_summary = summaries.get(sub._id)
        submissions.append(item)

    return SubmissionListResponse(
        submissions=submissions,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/submissions/{kobo_id}", response_model=Submission)
async def get_submission(
    kobo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get a single submission by its KoboToolbox ID (_id).
    Requires viewer access to the survey this submission belongs to.

    Returns the complete submission with all data and quality issues.
    """
    orm_submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()

    if not orm_submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")

    # Check user has access to the survey
    require_survey_access(db, current_user, orm_submission.survey_id, min_level="viewer")

    return _orm_to_pydantic_submission(orm_submission)


@router.get("/submissions/{kobo_id}/history", response_model=list[SubmissionHistory])
async def get_submission_history(
    kobo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get edit history for a submission.
    Requires viewer access to the survey this submission belongs to.

    Returns all historical versions with JSON patch diffs, ordered by timestamp (newest first).
    """
    # First verify submission exists
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")

    # Check user has access to the survey
    require_survey_access(db, current_user, submission.survey_id, min_level="viewer")

    # Get all history records for this submission
    orm_history = (
        db.query(SubmissionHistoryORM)
        .filter(SubmissionHistoryORM.kobo_id == kobo_id)
        .order_by(SubmissionHistoryORM.timestamp.desc())
        .all()
    )

    return [_orm_to_pydantic_history(h) for h in orm_history]


@router.get("/submissions/{kobo_id}/kobo-edit-url")
async def get_kobo_edit_url(
    kobo_id: int,
    survey_id: UUIDType = Query(..., description="Survey ID to get the Kobo asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get the Kobo edit URL for a submission.
    Requires editor access to the survey (since editing submissions is an edit action).

    This endpoint calls the Kobo API to get the Enketo edit URL for a specific submission.
    The user must have their own Kobo API key configured and have Kobo-level access to the form.

    Args:
        kobo_id: Submission ID (_id from Kobo)
        survey_id: Survey ID to get the kobo_asset_id from survey config

    Returns:
        JSON with 'url' field containing the Enketo edit URL
    """
    # Verify submission exists
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")

    # Authorize against the submission's OWN survey, never the caller-supplied
    # survey_id. _id is a global primary key across all surveys, so trusting the
    # query parameter let a user with editor rights on ANY survey mutate
    # submissions belonging to another one.
    survey_id = submission.survey_id
    # Check user has editor access to the survey
    survey_config = require_survey_access(db, current_user, survey_id, min_level="editor")

    if not survey_config.kobo_asset_id:
        raise HTTPException(
            status_code=400, detail=f"Survey {survey_id} does not have a kobo_asset_id configured"
        )

    # Get user's Kobo API token
    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400,
            detail="You need to configure your Kobo API key in user settings to get edit URLs",
        )

    kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    fetcher = KoboFetcher(api_token=kobo_token, api_url=kobo_api_url)
    # Kobo answers {"url": "...", "version_uid": "..."}.
    endpoint = f"/assets/{survey_config.kobo_asset_id}/data/{kobo_id}/enketo/edit/"
    try:
        response = fetcher._make_request(endpoint, params={"return_url": "false"})
    except requests.RequestException as e:
        logger.warning("Kobo edit link failed for submission %s: %s", kobo_id, e)
        raise HTTPException(status_code=502, detail="Could not get the edit link from Kobo.") from e
    if "url" not in response:
        raise HTTPException(status_code=502, detail="Kobo did not return an edit link.")
    return {"url": response["url"]}


@router.patch("/submissions/{kobo_id}/validation-status", response_model=Submission)
async def update_submission_validation_status(
    kobo_id: int,
    status_update: ValidationStatusUpdate,
    survey_id: UUIDType = Query(..., description="Survey ID to get the Kobo asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update the Kobo validation status for a submission.
    Requires editor access to the survey.

    This updates the validation status in KoboToolbox via API and stores it locally.
    Field Compass qa_status remains computed and will sync on next ETL run.

    Args:
        kobo_id: Submission ID (_id from Kobo)
        status_update: Validation status to set (Approved, Not Approved, On Hold, or null)
        survey_id: Survey ID to get the kobo_asset_id

    Returns:
        Updated submission
    """
    # Verify submission exists
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")

    # Authorize against the submission's OWN survey, never the caller-supplied
    # survey_id. _id is a global primary key across all surveys, so trusting the
    # query parameter let a user with editor rights on ANY survey mutate
    # submissions belonging to another one.
    survey_id = submission.survey_id
    # Check user has editor access
    survey_config = require_survey_access(db, current_user, survey_id, min_level="editor")

    if not survey_config.kobo_asset_id:
        raise HTTPException(
            status_code=400, detail=f"Survey {survey_id} does not have a kobo_asset_id configured"
        )

    # Get user's Kobo API token
    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400, detail="You need to configure your Kobo API key in user settings"
        )

    # Validate status value
    valid_statuses = ["Approved", "Not Approved", "On Hold", None]
    if status_update.validation_status not in valid_statuses:
        raise HTTPException(
            status_code=400, detail=f"Invalid validation status. Must be one of: {valid_statuses}"
        )

    kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    fetcher = KoboFetcher(api_token=kobo_token, api_url=kobo_api_url)
    try:
        fetcher.update_validation_status(
            asset_uid=survey_config.kobo_asset_id,
            submission_id=kobo_id,
            validation_status=status_update.validation_status,
        )
    except requests.RequestException as e:
        logger.error(f"Kobo API error updating validation status: {e}")
        if e.response is not None:
            logger.error(f"Response: {e.response.text[:500]}")
        raise HTTPException(
            status_code=502, detail=f"Failed to update validation status in Kobo: {e!s}"
        ) from e

    submission.kobo_validation_status = status_update.validation_status

    # Recalculate qa_status from the new validation status and the existing
    # issues, so the quality overview moves without waiting for the next pull.
    quality_issues = [
        QualityIssue(**issue_dict) for issue_dict in submission.data_quality_issues or []
    ]
    new_qa_status = HFCEngine(db, survey_config).determine_qa_status(
        quality_issues, status_update.validation_status
    )
    # "On Hold" answers None: no change.
    if new_qa_status is not None:
        submission.qa_status = new_qa_status

    submission.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(submission)

    logger.info(
        f"Updated validation status for submission {kobo_id} to '{status_update.validation_status}' "
        f"and qa_status to '{submission.qa_status}' by user {current_user.email}"
    )
    return _orm_to_pydantic_submission(submission)


@router.patch("/submissions/{kobo_id}/reviewer-notes", response_model=Submission)
async def update_submission_reviewer_notes(
    kobo_id: int,
    notes_update: ReviewerNotesUpdate,
    survey_id: UUIDType = Query(..., description="Survey ID for access control"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update reviewer notes for a submission.
    Requires editor access to the survey.

    Args:
        kobo_id: Submission ID (_id from Kobo)
        notes_update: Reviewer notes (text or null to clear)
        survey_id: Survey ID for permission checks

    Returns:
        Updated submission
    """
    # Verify submission exists
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")

    # Authorize against the submission's OWN survey, never the caller-supplied
    # survey_id. _id is a global primary key across all surveys, so trusting the
    # query parameter let a user with editor rights on ANY survey mutate
    # submissions belonging to another one.
    survey_id = submission.survey_id
    # Check user has editor access
    require_survey_access(db, current_user, survey_id, min_level="editor")

    submission.reviewer_notes = notes_update.reviewer_notes
    submission.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(submission)

    logger.info(f"Updated reviewer notes for submission {kobo_id} by user {current_user.email}")
    return _orm_to_pydantic_submission(submission)

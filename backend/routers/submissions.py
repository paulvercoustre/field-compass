"""
Submission API endpoints.
Handles CRUD operations for survey submissions with permission checks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional, Dict, Any
from uuid import UUID as UUIDType
from datetime import datetime
import requests
import logging

from services.database import get_db
from services.auth import get_current_active_user, get_user_kobo_token
from services.permissions import require_survey_access, can_view_survey
from database.models import SubmissionCurrent, SubmissionHistory as SubmissionHistoryORM, SurveyConfig, User
from models import Submission, SubmissionHistory, SubmissionListResponse, QualityIssue, JsonPatch, ValidationStatusUpdate
from etl.kobo_fetcher import KoboFetcher

router = APIRouter()
logger = logging.getLogger(__name__)


def _orm_to_pydantic_submission(orm_submission: SubmissionCurrent) -> Submission:
    """Convert ORM model to Pydantic model."""
    # Convert JSONB quality issues to Pydantic models
    quality_issues = []
    if orm_submission.data_quality_issues:
        for issue in orm_submission.data_quality_issues:
            quality_issues.append(QualityIssue(**issue))
    
    return Submission(
        _id=orm_submission._id,  # validation_alias will handle the underscore
        _uuid=orm_submission._uuid,
        _submission_time=orm_submission._submission_time,
        end=orm_submission.end,
        submission_data=orm_submission.submission_data,
        is_edited=orm_submission.is_edited,
        data_quality_issues=quality_issues,
        qa_status=orm_submission.qa_status,
        kobo_validation_status=orm_submission.kobo_validation_status,
        kobo_edit_url=orm_submission.kobo_edit_url,
    )


def _orm_to_pydantic_history(orm_history: SubmissionHistoryORM) -> SubmissionHistory:
    """Convert ORM history model to Pydantic model."""
    # Convert JSONB data_delta to JsonPatch models
    patches = []
    if orm_history.data_delta:
        for patch in orm_history.data_delta:
            patches.append(JsonPatch(**patch))
    
    return SubmissionHistory(
        history_id=orm_history.history_id,
        kobo_id=orm_history.kobo_id,
        timestamp=orm_history.timestamp,
        deprecated_uuid=orm_history.deprecated_uuid,
        data_delta=patches,
    )


def _get_field_value_from_jsonb(submission_data: Dict[str, Any], field_name: str) -> Any:
    """
    Get field value from JSONB submission_data, handling Kobo path-based field names.
    
    Kobo stores fields with full paths like 'module/variable', but config may only
    specify 'variable'. This function searches for the field by:
    1. Direct lookup (exact match)
    2. Path-based search (field name at end of path)
    
    Args:
        submission_data: Submission data dictionary
        field_name: Field name from config (may be just the variable name)
        
    Returns:
        Field value or None if not found
    """
    # First try direct lookup
    if field_name in submission_data:
        return submission_data[field_name]
    
    # Search for fields that end with the field name (path-based)
    # e.g., 'enumerator_id' should match 'sampling_information/enumerator_id'
    for key in submission_data.keys():
        if key.endswith(f'/{field_name}') or key == field_name:
            return submission_data[key]
    
    # Not found
    return None


@router.get("/submissions", response_model=SubmissionListResponse)
async def get_submissions(
    qa_status: Optional[str] = Query(None, description="Filter by QA status (comma-separated for multiple)"),
    validation_status: Optional[str] = Query(None, description="Filter by validation status (comma-separated: Approved,Not Approved,On Hold,Not Reviewed)"),
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    enumerator: Optional[str] = Query(None, description="Filter by enumerator ID/value (comma-separated for multiple)"),
    sampling_filters: Optional[str] = Query(None, description="Filter by sampling variables (format: variable1=value1,value2;variable2=value3)"),
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
        raise HTTPException(
            status_code=400,
            detail="survey_id is required"
        )
    
    # Validate and parse survey_id
    try:
        survey_uuid = UUIDType(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level='viewer')
    
    # Build query
    query = db.query(SubmissionCurrent).filter(SubmissionCurrent.survey_id == survey_uuid)

    # Apply qa_status filter
    if qa_status:
        qa_statuses = [s.strip() for s in qa_status.split(',') if s.strip()]
        if len(qa_statuses) == 1:
            query = query.filter(SubmissionCurrent.qa_status == qa_statuses[0])
        else:
            query = query.filter(SubmissionCurrent.qa_status.in_(qa_statuses))
    
    # Apply validation_status filter
    if validation_status:
        validation_statuses = [s.strip() for s in validation_status.split(',') if s.strip()]
        # Handle "Not Reviewed" as NULL
        if "Not Reviewed" in validation_statuses:
            validation_statuses.remove("Not Reviewed")
            if len(validation_statuses) == 0:
                # Only "Not Reviewed" was specified
                query = query.filter(SubmissionCurrent.kobo_validation_status.is_(None))
            else:
                # "Not Reviewed" plus other statuses
                query = query.filter(
                    or_(
                        SubmissionCurrent.kobo_validation_status.is_(None),
                        SubmissionCurrent.kobo_validation_status.in_(validation_statuses)
                    )
                )
        else:
            # No "Not Reviewed" specified
            if len(validation_statuses) == 1:
                query = query.filter(SubmissionCurrent.kobo_validation_status == validation_statuses[0])
            else:
                query = query.filter(SubmissionCurrent.kobo_validation_status.in_(validation_statuses))
    
    # Get all submissions (we'll filter by JSONB fields in Python)
    # Note: This could be optimized with PostgreSQL JSONB queries, but filtering
    # in Python is more reliable for path-based field matching
    orm_submissions = query.order_by(SubmissionCurrent._submission_time.desc()).all()
    
    # Get enumerator field name from survey config
    enumerator_field = None
    if survey_config and survey_config.config_data:
        config = survey_config.config_data
        core_ids = config.get("core_identifiers", {})
        enumerator_field = core_ids.get("enumerator", "enumerator_id")
    
    # Get sampling columns from survey config
    sampling_cols = []
    if survey_config and survey_config.config_data:
        config = survey_config.config_data
        sampling_frame_config = config.get("sampling_frame", {})
        sampling_cols = sampling_frame_config.get("sampling_cols", [])
    
    # Filter by enumerator if provided
    if enumerator and enumerator_field:
        enumerators = [e.strip() for e in enumerator.split(',') if e.strip()]
        filtered_submissions = []
        for sub in orm_submissions:
            if sub.submission_data:
                enum_value = _get_field_value_from_jsonb(sub.submission_data, enumerator_field)
                if enum_value and str(enum_value) in enumerators:
                    filtered_submissions.append(sub)
        orm_submissions = filtered_submissions
    
    # Filter by sampling filters if provided
    if sampling_filters:
        # Parse sampling filters: "variable1=value1,value2;variable2=value3"
        sampling_filter_parts = [part.strip() for part in sampling_filters.split(';') if part.strip()]

        for filter_part in sampling_filter_parts:
            if '=' not in filter_part:
                continue

            variable, values_str = filter_part.split('=', 1)
            variable = variable.strip()
            values = [v.strip() for v in values_str.split(',') if v.strip()]

            if not values or variable not in sampling_cols:
                continue

            filtered_submissions = []
            for sub in orm_submissions:
                if sub.submission_data:
                    var_value = _get_field_value_from_jsonb(sub.submission_data, variable)
                    if var_value and str(var_value) in values:
                        filtered_submissions.append(sub)
            orm_submissions = filtered_submissions
    
    # Get total count after JSONB filtering
    total = len(orm_submissions)
    
    # Apply pagination
    offset = (page - 1) * page_size
    paginated_submissions = orm_submissions[offset:offset + page_size]
    
    # Convert to Pydantic models
    submissions = [_orm_to_pydantic_submission(sub) for sub in paginated_submissions]
    
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
    require_survey_access(db, current_user, orm_submission.survey_id, min_level='viewer')
    
    return _orm_to_pydantic_submission(orm_submission)


@router.get("/submissions/{kobo_id}/history", response_model=List[SubmissionHistory])
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
    require_survey_access(db, current_user, submission.survey_id, min_level='viewer')
    
    # Get all history records for this submission
    orm_history = (
        db.query(SubmissionHistoryORM)
        .filter(SubmissionHistoryORM.kobo_id == kobo_id)
        .order_by(SubmissionHistoryORM.timestamp.desc())
        .all()
    )
    
    # Convert to Pydantic models
    history = [_orm_to_pydantic_history(h) for h in orm_history]
    
    return history


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
    
    # Check user has editor access to the survey
    survey_config = require_survey_access(db, current_user, survey_id, min_level='editor')
    
    if not survey_config.kobo_asset_id:
        raise HTTPException(
            status_code=400, 
            detail=f"Survey {survey_id} does not have a kobo_asset_id configured"
        )
    
    # Get user's Kobo API token
    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400,
            detail="You need to configure your Kobo API key in user settings to get edit URLs"
        )
    
    try:
        # Create Kobo fetcher with user's token
        kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
        fetcher = KoboFetcher(api_token=kobo_token, api_url=kobo_api_url)
        
        # Call Kobo API to get edit URL
        # Format: /assets/{asset_id}/data/{submission_id}/enketo/edit/?return_url=false
        endpoint = f"/assets/{survey_config.kobo_asset_id}/data/{kobo_id}/enketo/edit/"
        params = {"return_url": "false"}
        
        response = fetcher._make_request(endpoint, params=params)
        
        # Kobo API returns: {"url": "...", "version_uid": "..."}
        if "url" not in response:
            raise HTTPException(
                status_code=500,
                detail="Kobo API did not return a URL in the response"
            )
        
        return {"url": response["url"]}
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get Kobo edit URL: {str(e)}"
        )


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
    
    # Check user has editor access
    survey_config = require_survey_access(db, current_user, survey_id, min_level='editor')
    
    if not survey_config.kobo_asset_id:
        raise HTTPException(
            status_code=400,
            detail=f"Survey {survey_id} does not have a kobo_asset_id configured"
        )
    
    # Get user's Kobo API token
    kobo_token = get_user_kobo_token(current_user)
    if not kobo_token:
        raise HTTPException(
            status_code=400,
            detail="You need to configure your Kobo API key in user settings"
        )
    
    # Validate status value
    valid_statuses = ['Approved', 'Not Approved', 'On Hold', None]
    if status_update.validation_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid validation status. Must be one of: {valid_statuses}"
        )
    
    try:
        # Update validation status in Kobo
        kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
        fetcher = KoboFetcher(api_token=kobo_token, api_url=kobo_api_url)
        
        fetcher.update_validation_status(
            asset_uid=survey_config.kobo_asset_id,
            submission_id=kobo_id,
            validation_status=status_update.validation_status
        )
        
        # Update local database
        submission.kobo_validation_status = status_update.validation_status
        submission.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(submission)
        
        logger.info(
            f"Updated validation status for submission {kobo_id} to '{status_update.validation_status}' "
            f"by user {current_user.email}"
        )
        
        # Return updated submission
        return _orm_to_pydantic_submission(submission)
        
    except requests.exceptions.HTTPError as e:
        db.rollback()
        logger.error(f"Kobo API error updating validation status: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Response: {e.response.text[:500]}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to update validation status in Kobo: {str(e)}"
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating validation status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update validation status: {str(e)}"
        )

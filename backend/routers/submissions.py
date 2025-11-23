"""
Submission API endpoints.
Handles CRUD operations for survey submissions.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional, Dict, Any
from uuid import UUID as UUIDType
import json

from services.database import get_db
from database.models import SubmissionCurrent, SubmissionHistory as SubmissionHistoryORM, SurveyConfig
from models import Submission, SubmissionHistory, SubmissionListResponse, QualityIssue, JsonPatch

router = APIRouter()


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
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    enumerator: Optional[str] = Query(None, description="Filter by enumerator ID/value (comma-separated for multiple)"),
    sampling_filters: Optional[str] = Query(None, description="Filter by sampling variables (format: variable1=value1,value2;variable2=value3)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
):
    """
    Get list of submissions with optional filtering and pagination.

    Supports filtering by:
    - qa_status: Comma-separated QA statuses (e.g., "FLAGGED,PENDING_APPROVAL")
    - survey_id: Filter by specific survey (UUID)
    - enumerator: Comma-separated enumerator IDs/values (e.g., "enum1,enum2")
    - sampling_filters: Sampling filters in format "variable1=value1,value2;variable2=value3"
      (e.g., "district=kamdesh,nangarhar;livelihood=farming,trading")

    Returns paginated results with total count.
    """
    # Build query
    query = db.query(SubmissionCurrent)
    
    # Get survey config if survey_id is provided (needed for field name resolution)
    survey_config = None
    if survey_id:
        try:
            survey_uuid = UUIDType(survey_id)
            query = query.filter(SubmissionCurrent.survey_id == survey_uuid)
            survey_config = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
            )
    elif enumerator or sampling_filters:
        # If filtering by enumerator or sampling filters, we need survey_id
        raise HTTPException(
            status_code=400,
            detail="survey_id is required when filtering by enumerator or sampling variables"
        )

    # Apply qa_status filter
    if qa_status:
        qa_statuses = [s.strip() for s in qa_status.split(',') if s.strip()]
        if len(qa_statuses) == 1:
            query = query.filter(SubmissionCurrent.qa_status == qa_statuses[0])
        else:
            query = query.filter(SubmissionCurrent.qa_status.in_(qa_statuses))
    
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
):
    """
    Get a single submission by its KoboToolbox ID (_id).
    
    Returns the complete submission with all data and quality issues.
    """
    orm_submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    
    if not orm_submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")
    
    return _orm_to_pydantic_submission(orm_submission)


@router.get("/submissions/{kobo_id}/history", response_model=List[SubmissionHistory])
async def get_submission_history(
    kobo_id: int,
    db: Session = Depends(get_db),
):
    """
    Get edit history for a submission.
    Returns all historical versions with JSON patch diffs, ordered by timestamp (newest first).
    """
    # First verify submission exists
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")
    
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



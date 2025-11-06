"""
Submission API endpoints.
Handles CRUD operations for survey submissions.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID as UUIDType

from services.database import get_db
from database.models import SubmissionCurrent, SubmissionHistory as SubmissionHistoryORM
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


@router.get("/submissions", response_model=SubmissionListResponse)
async def get_submissions(
    qa_status: Optional[str] = Query(None, description="Filter by QA status"),
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
):
    """
    Get list of submissions with optional filtering and pagination.
    
    Supports filtering by:
    - qa_status: HFC_FLAGGED, PENDING_QA, PENDING_RE_QA, APPROVED
    - survey_id: Filter by specific survey (UUID)
    
    Returns paginated results with total count.
    """
    # Build query
    query = db.query(SubmissionCurrent)
    
    # Apply filters
    if qa_status:
        query = query.filter(SubmissionCurrent.qa_status == qa_status)
    
    if survey_id:
        try:
            survey_uuid = UUIDType(survey_id)
            query = query.filter(SubmissionCurrent.survey_id == survey_uuid)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
            )
    
    # Get total count before pagination
    total = query.count()
    
    # Apply pagination
    offset = (page - 1) * page_size
    orm_submissions = query.order_by(SubmissionCurrent._submission_time.desc()).offset(offset).limit(page_size).all()
    
    # Convert to Pydantic models
    submissions = [_orm_to_pydantic_submission(sub) for sub in orm_submissions]
    
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

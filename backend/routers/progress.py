"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, SurveyConfig
from models import PerformanceData, ProgressData
from services.database import get_db
from services.permissions import survey_access
from services.progress import compute_performance, compute_progress, performance_unavailable
from services.survey_config import get_enumerator_field

router = APIRouter()


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(
    survey_config: SurveyConfig = Depends(survey_access("viewer")),
    approved_only: bool = Query(
        False,
        description="When true, only count submissions whose qa_status is APPROVED.",
    ),
    db: Session = Depends(get_db),
):
    """
    Get data collection progress metrics for a specific survey.
    Requires viewer access to the survey.

    Returns overall progress, by sampling column disaggregations, and detailed breakdown.

    Progress is calculated by counting completed surveys (submissions) against targets
    from the sampling frame. Disaggregations are dynamically generated based on
    the sampling_cols in the survey configuration.

    Submissions included:
    - approved_only=False (default): all submissions except REJECTED (Not accepted).
    - approved_only=True: only submissions with qa_status APPROVED.
    """
    # Build query filtered by survey
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )

    # Filter submissions by qa_status
    if approved_only:
        query = query.filter(SubmissionCurrent.qa_status == "APPROVED")
    else:
        # Default: exclude REJECTED (Not accepted)
        query = query.filter(SubmissionCurrent.qa_status != "REJECTED")

    # Get all submissions (completed surveys)
    submissions = query.all()

    return compute_progress(submissions, survey_config.config_data)


@router.get("/performance", response_model=PerformanceData)
async def get_performance_data(
    survey_config: SurveyConfig = Depends(survey_access("viewer")),
    db: Session = Depends(get_db),
):
    """
    Get enumerator performance metrics for a specific survey.
    Requires viewer access to the survey.

    Returns collection stats and quality metrics per enumerator.

    Quality metrics include:
    - avgActiveTime: Average active interview time (minutes) from audit logs
    - avgTotalTime: Average total duration (minutes) from audit logs
    - avgDkRate: Average percentage of "Don't Know" values per submission
    - avgIssuesPerSurvey: Average number of quality issues per submission

    Note: Active time and total time metrics require audit logs to be processed
    during ETL. If audit logs are not available, these values will be 0.

    The figures are computed in services/progress.py.
    """
    config = survey_config.config_data
    if not get_enumerator_field(config):
        return performance_unavailable(config)

    submissions = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey_config.survey_id)
        .all()
    )
    return compute_performance(submissions, config)

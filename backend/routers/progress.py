"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from database.models import SubmissionCurrent, ValidationRule
from schemas import PerformanceData, ProgressData
from services.database import DbSession
from services.metrics import is_approved, is_not_approved
from services.permissions import ViewableSurvey
from services.progress import compute_performance, compute_progress, performance_unavailable
from services.submission_filters import within_dates
from services.survey_config import get_enumerator_field

router = APIRouter()


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(
    survey_config: ViewableSurvey,
    db: DbSession,
    approved_only: Annotated[
        bool, Query(description="When true, count only submissions marked Approved in Kobo.")
    ] = False,
):
    """
    Get data collection progress metrics for a specific survey.
    Requires viewer access to the survey.

    Returns overall progress, by sampling column disaggregations, and detailed breakdown.

    Progress is calculated by counting completed surveys (submissions) against targets
    from the sampling frame. Disaggregations are dynamically generated based on
    the sampling_cols in the survey configuration.

    Submissions counted, by the reviewer's decision in Kobo (services/metrics.py):
    - approved_only=False (default): every submission except Not approved.
    - approved_only=True: only Approved ones.
    Either way the response says how many are Not approved, so the page can say
    what it leaves out.
    """
    submissions = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey_config.survey_id)
        .all()
    )
    if approved_only:
        counted = [sub for sub in submissions if is_approved(sub)]
    else:
        counted = [sub for sub in submissions if not is_not_approved(sub)]

    progress = compute_progress(counted, survey_config.config_data)
    progress.not_approved = sum(1 for sub in submissions if is_not_approved(sub))
    return progress


@router.get("/performance", response_model=PerformanceData)
async def get_performance_data(
    survey_config: ViewableSurvey,
    db: DbSession,
    start_date: Annotated[str | None, Query(description="Sent on or after (YYYY-MM-DD)")] = None,
    end_date: Annotated[str | None, Query(description="Sent on or before (YYYY-MM-DD)")] = None,
):
    """
    Get enumerator performance metrics for a specific survey.
    Requires viewer access to the survey.

    Returns the named counts and measurements (services/metrics.py) for the
    team, each enumerator, and the submissions with no enumerator recorded.
    The team is every submission, with Data quality's definitions, so the two
    pages show the same figures.
    """
    config = survey_config.config_data
    if not get_enumerator_field(config):
        return performance_unavailable(config)

    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    performance = compute_performance(within_dates(query, start_date, end_date).all(), config)
    performance.custom_checks = (
        db.query(ValidationRule)
        .filter(
            ValidationRule.survey_id == survey_config.survey_id,
            ValidationRule.is_active == True,  # noqa: E712 - SQLAlchemy needs `== True`
        )
        .count()
    )
    return performance

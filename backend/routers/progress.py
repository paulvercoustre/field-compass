"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from database.models import SubmissionCurrent
from schemas import PerformanceData, ProgressData
from services.database import DbSession
from services.permissions import ViewableSurvey
from services.progress import compute_performance, compute_progress, performance_unavailable
from services.submission_filters import within_dates
from services.survey_config import custom_checks, get_enumerator_field

router = APIRouter()


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(survey_config: ViewableSurvey, db: DbSession):
    """
    Get data collection progress metrics for a specific survey.
    Requires viewer access to the survey.

    Returns overall progress, by sampling column disaggregations, and detailed breakdown.

    Progress is calculated by counting completed surveys (submissions) against targets
    from the sampling frame. Disaggregations are dynamically generated based on
    the sampling_cols in the survey configuration.

    Every submission except Not approved counts (decided 2026-10-09); each
    count carries its Approved part, the last 7 days and the Not approved left
    out (services/progress.py), with the days of collection for the chart.
    """
    submissions = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey_config.survey_id)
        .all()
    )
    return compute_progress(submissions, survey_config.config_data)


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
    performance.custom_checks = custom_checks(survey_config)
    return performance

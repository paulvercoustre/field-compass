"""
Quality Overview API endpoints.
Provides aggregated quality metrics for the quality dashboard.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from database.models import SubmissionCurrent
from schemas import QualityOverviewResponse
from services.database import DbSession
from services.permissions import ViewableSurvey
from services.quality import quality_overview
from services.submission_filters import (
    filter_by_answers,
    parse_list,
    parse_sampling_filters,
    within_dates,
)
from services.survey_config import get_enumerator_field, get_sampling_cols

router = APIRouter()


@router.get("/quality/overview", response_model=QualityOverviewResponse)
async def get_quality_overview(
    survey_config: ViewableSurvey,
    db: DbSession,
    start_date: Annotated[str | None, Query(description="Start date filter (YYYY-MM-DD)")] = None,
    end_date: Annotated[str | None, Query(description="End date filter (YYYY-MM-DD)")] = None,
    enumerator: Annotated[
        str | None, Query(description="Filter by enumerator ID (comma-separated for multiple)")
    ] = None,
    sampling_filters: Annotated[
        str | None,
        Query(description="Filter by sampling variables (format: var1=val1,val2;var2=val3)"),
    ] = None,
):
    """
    Get quality overview data for the dashboard: the named counts and
    measurements, issue frequency and daily trends (services/quality.py),
    over the submissions the filters leave (services/submission_filters.py).

    Requires viewer access to the specified survey.
    """
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    query = within_dates(query, start_date, end_date)

    config = survey_config.config_data or {}
    submissions = filter_by_answers(
        query.all(),
        enumerator_field=get_enumerator_field(config),
        enumerators=parse_list(enumerator),
        sampling_filters=parse_sampling_filters(sampling_filters),
        sampling_cols=get_sampling_cols(config),
    )
    return quality_overview(submissions, config)

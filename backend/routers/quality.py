"""
Quality Overview API endpoints.
Provides aggregated quality metrics for the quality dashboard.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, SurveyConfig
from models import QualityOverviewResponse
from services.database import get_db
from services.permissions import survey_access
from services.quality import quality_overview
from services.submission_filters import filter_by_answers, parse_list, parse_sampling_filters
from services.survey_config import get_enumerator_field, get_sampling_cols

router = APIRouter()


def _parse_date(value: str, name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid {name} format: {value}. Use YYYY-MM-DD."
        ) from None


@router.get("/quality/overview", response_model=QualityOverviewResponse)
async def get_quality_overview(
    start_date: str | None = Query(None, description="Start date filter (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="End date filter (YYYY-MM-DD)"),
    enumerator: str | None = Query(
        None, description="Filter by enumerator ID (comma-separated for multiple)"
    ),
    sampling_filters: str | None = Query(
        None, description="Filter by sampling variables (format: var1=val1,val2;var2=val3)"
    ),
    survey_config: SurveyConfig = Depends(survey_access("viewer")),
    db: Session = Depends(get_db),
):
    """
    Get quality overview data for the dashboard: submission status breakdown,
    quality metrics, issue frequency and daily trends (services/quality.py),
    over the submissions the filters leave (services/submission_filters.py).

    Requires viewer access to the specified survey.
    """
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    if start_date:
        query = query.filter(
            SubmissionCurrent._submission_time >= _parse_date(start_date, "start_date")
        )
    if end_date:
        # The whole of the end date.
        end_dt = _parse_date(end_date, "end_date").replace(hour=23, minute=59, second=59)
        query = query.filter(SubmissionCurrent._submission_time <= end_dt)

    config = survey_config.config_data or {}
    submissions = filter_by_answers(
        query.all(),
        enumerator_field=get_enumerator_field(config),
        enumerators=parse_list(enumerator),
        sampling_filters=parse_sampling_filters(sampling_filters),
        sampling_cols=get_sampling_cols(config),
    )
    return quality_overview(submissions)

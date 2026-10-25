"""
Quality Overview API endpoints.
Provides aggregated quality metrics for the quality dashboard.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from database.models import SubmissionHistory
from schemas import QualityOverviewResponse, QuestionsResponse
from services.database import DbSession
from services.page_cache import cached
from services.permissions import ViewableSurvey
from services.quality import quality_overview
from services.questions import by_question
from services.submission_filters import (
    filter_by_answers,
    parse_list,
    parse_sampling_filters,
    within_dates,
)
from services.survey_config import custom_checks, get_enumerator_field, get_sampling_cols
from services.survey_rows import survey_rows

router = APIRouter()


@router.get("/quality/overview", response_model=QualityOverviewResponse)
def get_quality_overview(
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
    measurements, each check, the days of collection and which checks are on
    (services/quality.py), over the submissions the filters leave
    (services/submission_filters.py). Worked out once for each state of the
    survey (services/page_cache.py).

    Requires viewer access to the specified survey.
    """
    config = survey_config.config_data or {}

    def work_out() -> QualityOverviewResponse:
        query = within_dates(survey_rows(db, survey_config.survey_id), start_date, end_date)
        submissions = filter_by_answers(
            query.all(),
            enumerator_field=get_enumerator_field(config),
            enumerators=parse_list(enumerator),
            sampling_filters=parse_sampling_filters(sampling_filters),
            sampling_cols=get_sampling_cols(config),
        )
        return quality_overview(submissions, config)

    params = {
        "start_date": start_date,
        "end_date": end_date,
        "enumerator": enumerator,
        "sampling_filters": sampling_filters,
    }
    overview = cached(
        db, survey_config, "quality_overview", params, QualityOverviewResponse, work_out
    )
    overview.custom_checks = custom_checks(survey_config)
    return overview


@router.get("/quality/questions", response_model=QuestionsResponse)
def get_quality_by_question(
    survey_config: ViewableSurvey,
    db: DbSession,
    start_date: Annotated[str | None, Query(description="Start date filter (YYYY-MM-DD)")] = None,
    end_date: Annotated[str | None, Query(description="End date filter (YYYY-MM-DD)")] = None,
):
    """
    Data quality by question (services/questions.py): every question of the
    form, how often it was asked, answered "don't know" or "Other", flagged
    and corrected in Kobo, with what Form check found; the ones to look at
    first on top. Requires viewer access to the survey.
    """
    query = survey_rows(db, survey_config.survey_id)
    submissions = within_dates(query, start_date, end_date).all()
    ids = [sub._id for sub in submissions]
    history = (
        db.query(SubmissionHistory)
        .filter(
            SubmissionHistory.survey_id == survey_config.survey_id,
            SubmissionHistory.kobo_id.in_(ids),
        )
        .all()
        if ids
        else []
    )
    return by_question(submissions, survey_config, history)

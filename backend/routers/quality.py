"""
Quality Overview API endpoints.
Provides aggregated quality metrics for the quality dashboard.
"""

from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID as UUIDType

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, User
from models import (
    IssueFrequency,
    IssueTimeSeriesPoint,
    QualityMetricsSummary,
    QualityOverviewResponse,
    SubmissionStatusSummary,
    TemporalDataPoint,
)
from services.auth import get_current_active_user
from services.database import get_db
from services.permissions import require_survey_access
from services.survey_config import get_enumerator_field

router = APIRouter()


def _get_field_value_from_jsonb(submission_data: dict[str, Any], field_name: str) -> Any:
    """
    Get field value from JSONB submission_data, handling Kobo path-based field names.

    Kobo stores fields with full paths like 'module/variable', but config may only
    specify 'variable'. This function searches for the field by:
    1. Direct lookup (exact match)
    2. Path-based search (field name at end of path)
    """
    if not submission_data:
        return None

    # First try direct lookup
    if field_name in submission_data:
        return submission_data[field_name]

    # Search for fields that end with the field name (path-based)
    for key in submission_data.keys():
        if key.endswith(f"/{field_name}") or key == field_name:
            return submission_data[key]

    return None


def _parse_sampling_filters(sampling_filters_str: str) -> dict[str, list[str]]:
    """
    Parse sampling filters string into a dict.
    Format: "variable1=value1,value2;variable2=value3"
    Returns: {"variable1": ["value1", "value2"], "variable2": ["value3"]}
    """
    result = {}
    if not sampling_filters_str:
        return result

    filter_parts = [part.strip() for part in sampling_filters_str.split(";") if part.strip()]
    for filter_part in filter_parts:
        if "=" not in filter_part:
            continue
        variable, values_str = filter_part.split("=", 1)
        variable = variable.strip()
        values = [v.strip() for v in values_str.split(",") if v.strip()]
        if values:
            result[variable] = values

    return result


def _filter_submissions_by_jsonb(
    submissions: list[SubmissionCurrent],
    enumerator_field: str | None,
    enumerator_values: list[str] | None,
    sampling_filters: dict[str, list[str]],
    sampling_cols: list[str],
) -> list[SubmissionCurrent]:
    """
    Filter submissions by enumerator and sampling variables.
    """
    filtered = submissions

    # Filter by enumerator
    if enumerator_field and enumerator_values:
        filtered = [
            sub
            for sub in filtered
            if sub.submission_data
            and str(_get_field_value_from_jsonb(sub.submission_data, enumerator_field))
            in enumerator_values
        ]

    # Filter by sampling variables
    for variable, values in sampling_filters.items():
        if variable not in sampling_cols:
            continue
        filtered = [
            sub
            for sub in filtered
            if sub.submission_data
            and str(_get_field_value_from_jsonb(sub.submission_data, variable)) in values
        ]

    return filtered


@router.get("/quality/overview", response_model=QualityOverviewResponse)
async def get_quality_overview(
    survey_id: UUIDType = Query(..., description="Survey ID (required)"),
    start_date: str | None = Query(None, description="Start date filter (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="End date filter (YYYY-MM-DD)"),
    enumerator: str | None = Query(
        None, description="Filter by enumerator ID (comma-separated for multiple)"
    ),
    sampling_filters: str | None = Query(
        None, description="Filter by sampling variables (format: var1=val1,val2;var2=val3)"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get quality overview data for the dashboard.

    Returns aggregated metrics including:
    - Submission status breakdown (total, approved, not approved, on hold, not reviewed)
    - Quality metrics (total issues, avg issues per submission)
    - Issue frequency breakdown
    - Temporal trends (status and issues over time)

    Requires viewer access to the specified survey.
    """
    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_id, min_level="viewer")

    # Get config fields
    config = survey_config.config_data or {}
    enumerator_field = get_enumerator_field(config)
    sampling_frame_config = config.get("sampling_frame", {})
    sampling_cols = sampling_frame_config.get("sampling_cols", [])

    # Build base query
    query = db.query(SubmissionCurrent).filter(SubmissionCurrent.survey_id == survey_id)

    # Apply date filters
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(SubmissionCurrent._submission_time >= start_dt)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid start_date format: {start_date}. Use YYYY-MM-DD."
            )

    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            # Include the entire end date by adding a day
            end_dt = end_dt.replace(hour=23, minute=59, second=59)
            query = query.filter(SubmissionCurrent._submission_time <= end_dt)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid end_date format: {end_date}. Use YYYY-MM-DD."
            )

    # Fetch all matching submissions
    all_submissions = query.all()

    # Apply JSONB-based filters (enumerator, sampling variables)
    enumerator_values = None
    if enumerator:
        enumerator_values = [e.strip() for e in enumerator.split(",") if e.strip()]

    parsed_sampling_filters = _parse_sampling_filters(sampling_filters)

    submissions = _filter_submissions_by_jsonb(
        all_submissions,
        enumerator_field,
        enumerator_values,
        parsed_sampling_filters,
        sampling_cols,
    )

    # If no submissions, return empty response
    if not submissions:
        return QualityOverviewResponse(
            status_summary=SubmissionStatusSummary(
                total_submissions=0,
                approved_count=0,
                approved_percentage=0.0,
                not_approved_count=0,
                not_approved_percentage=0.0,
                on_hold_count=0,
                on_hold_percentage=0.0,
                not_reviewed_count=0,
                not_reviewed_percentage=0.0,
            ),
            quality_metrics=QualityMetricsSummary(
                total_issues=0,
                submissions_with_issues=0,
                avg_issues_per_submission=0.0,
                avg_dk_percentage=None,
            ),
            issue_frequency=[],
            temporal_data=[],
            issue_time_series=[],
            date_range={"start": "", "end": ""},
        )

    # Calculate status summary by Kobo validation status
    total = len(submissions)
    approved_count = sum(1 for s in submissions if s.kobo_validation_status == "Approved")
    not_approved_count = sum(1 for s in submissions if s.kobo_validation_status == "Not Approved")
    on_hold_count = sum(1 for s in submissions if s.kobo_validation_status == "On Hold")
    not_reviewed_count = sum(1 for s in submissions if s.kobo_validation_status is None)

    status_summary = SubmissionStatusSummary(
        total_submissions=total,
        approved_count=approved_count,
        approved_percentage=round(approved_count / total * 100, 1) if total > 0 else 0.0,
        not_approved_count=not_approved_count,
        not_approved_percentage=round(not_approved_count / total * 100, 1) if total > 0 else 0.0,
        on_hold_count=on_hold_count,
        on_hold_percentage=round(on_hold_count / total * 100, 1) if total > 0 else 0.0,
        not_reviewed_count=not_reviewed_count,
        not_reviewed_percentage=round(not_reviewed_count / total * 100, 1) if total > 0 else 0.0,
    )

    # Calculate quality metrics
    total_issues = 0
    submissions_with_issues = 0
    dk_percentages: list[float] = []
    active_durations: list[float] = []
    issue_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"count": 0, "affected": 0})

    for sub in submissions:
        issues = sub.data_quality_issues or []
        issue_count = len(issues)
        total_issues += issue_count

        if issue_count > 0:
            submissions_with_issues += 1

        if sub.dk_percentage is not None:
            dk_percentages.append(float(sub.dk_percentage))

        active_time = (sub.submission_data or {}).get("active_interview_time")
        if active_time is not None:
            try:
                active_durations.append(float(active_time))
            except (ValueError, TypeError):
                pass

        # Count each issue type (track unique submissions per issue type)
        seen_checks = set()
        for issue in issues:
            check = issue.get("check", "unknown")
            issue_counts[check]["count"] += 1
            if check not in seen_checks:
                issue_counts[check]["affected"] += 1
                seen_checks.add(check)

    avg_active_duration = (
        round(sum(active_durations) / len(active_durations), 1) if active_durations else None
    )
    quality_metrics = QualityMetricsSummary(
        total_issues=total_issues,
        submissions_with_issues=submissions_with_issues,
        avg_issues_per_submission=round(total_issues / total, 2) if total > 0 else 0.0,
        avg_dk_percentage=round(sum(dk_percentages) / len(dk_percentages), 2)
        if dk_percentages
        else None,
        avg_active_duration_minutes=avg_active_duration,
    )

    # Build issue frequency list (sorted by count descending)
    issue_frequency = [
        IssueFrequency(
            check=check,
            count=data["count"],
            percentage=round(data["affected"] / total * 100, 1) if total > 0 else 0.0,
            affected_submissions=data["affected"],
        )
        for check, data in issue_counts.items()
    ]
    issue_frequency.sort(key=lambda x: x.count, reverse=True)

    # Calculate temporal data (group by date)
    temporal_dict: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "total": 0,
            "approved": 0,
            "not_approved": 0,
            "on_hold": 0,
            "not_reviewed": 0,
            "issues": 0,
        }
    )
    issue_time_dict: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for sub in submissions:
        date_str = sub._submission_time.strftime("%Y-%m-%d")
        temporal_dict[date_str]["total"] += 1

        if sub.kobo_validation_status == "Approved":
            temporal_dict[date_str]["approved"] += 1
        elif sub.kobo_validation_status == "Not Approved":
            temporal_dict[date_str]["not_approved"] += 1
        elif sub.kobo_validation_status == "On Hold":
            temporal_dict[date_str]["on_hold"] += 1
        else:
            temporal_dict[date_str]["not_reviewed"] += 1  # None or unknown

        issues = sub.data_quality_issues or []
        temporal_dict[date_str]["issues"] += len(issues)

        for issue in issues:
            check = issue.get("check", "unknown")
            issue_time_dict[date_str][check] += 1

    # Convert to sorted lists
    sorted_dates = sorted(temporal_dict.keys())

    temporal_data = [
        TemporalDataPoint(
            date=date,
            total_submissions=temporal_dict[date]["total"],
            approved_count=temporal_dict[date]["approved"],
            not_approved_count=temporal_dict[date]["not_approved"],
            on_hold_count=temporal_dict[date]["on_hold"],
            not_reviewed_count=temporal_dict[date]["not_reviewed"],
            total_issues=temporal_dict[date]["issues"],
        )
        for date in sorted_dates
    ]

    issue_time_series = [
        IssueTimeSeriesPoint(
            date=date,
            issue_counts=dict(issue_time_dict[date]),
        )
        for date in sorted_dates
    ]

    # Get date range
    date_range = {
        "start": sorted_dates[0] if sorted_dates else "",
        "end": sorted_dates[-1] if sorted_dates else "",
    }

    return QualityOverviewResponse(
        status_summary=status_summary,
        quality_metrics=quality_metrics,
        issue_frequency=issue_frequency,
        temporal_data=temporal_data,
        issue_time_series=issue_time_series,
        date_range=date_range,
    )

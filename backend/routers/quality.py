"""
Quality Overview API endpoints.
Provides aggregated quality metrics for the quality dashboard.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text
from typing import Optional, Dict, Any, List
from uuid import UUID as UUIDType
from datetime import datetime
from collections import defaultdict

from services.database import get_db
from services.auth import get_current_active_user
from services.permissions import require_survey_access
from database.models import SubmissionCurrent, SurveyConfig, User
from models import (
    QualityOverviewResponse,
    SubmissionStatusSummary,
    QualityMetricsSummary,
    IssueFrequency,
    TemporalDataPoint,
    IssueTimeSeriesPoint,
)

router = APIRouter()


def _get_field_value_from_jsonb(submission_data: Dict[str, Any], field_name: str) -> Any:
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
        if key.endswith(f'/{field_name}') or key == field_name:
            return submission_data[key]
    
    return None


def _parse_sampling_filters(sampling_filters_str: str) -> Dict[str, List[str]]:
    """
    Parse sampling filters string into a dict.
    Format: "variable1=value1,value2;variable2=value3"
    Returns: {"variable1": ["value1", "value2"], "variable2": ["value3"]}
    """
    result = {}
    if not sampling_filters_str:
        return result
    
    filter_parts = [part.strip() for part in sampling_filters_str.split(';') if part.strip()]
    for filter_part in filter_parts:
        if '=' not in filter_part:
            continue
        variable, values_str = filter_part.split('=', 1)
        variable = variable.strip()
        values = [v.strip() for v in values_str.split(',') if v.strip()]
        if values:
            result[variable] = values
    
    return result


def _filter_submissions_by_jsonb(
    submissions: List[SubmissionCurrent],
    enumerator_field: Optional[str],
    enumerator_values: Optional[List[str]],
    sampling_filters: Dict[str, List[str]],
    sampling_cols: List[str],
) -> List[SubmissionCurrent]:
    """
    Filter submissions by enumerator and sampling variables.
    """
    filtered = submissions
    
    # Filter by enumerator
    if enumerator_field and enumerator_values:
        filtered = [
            sub for sub in filtered
            if sub.submission_data and 
            str(_get_field_value_from_jsonb(sub.submission_data, enumerator_field)) in enumerator_values
        ]
    
    # Filter by sampling variables
    for variable, values in sampling_filters.items():
        if variable not in sampling_cols:
            continue
        filtered = [
            sub for sub in filtered
            if sub.submission_data and
            str(_get_field_value_from_jsonb(sub.submission_data, variable)) in values
        ]
    
    return filtered


@router.get("/quality/overview", response_model=QualityOverviewResponse)
async def get_quality_overview(
    survey_id: UUIDType = Query(..., description="Survey ID (required)"),
    start_date: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    enumerator: Optional[str] = Query(None, description="Filter by enumerator ID (comma-separated for multiple)"),
    sampling_filters: Optional[str] = Query(None, description="Filter by sampling variables (format: var1=val1,val2;var2=val3)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get quality overview data for the dashboard.
    
    Returns aggregated metrics including:
    - Submission status breakdown (total, approved, pending, flagged, rejected)
    - Quality metrics (total issues, avg issues per submission)
    - Issue frequency breakdown
    - Temporal trends (status and issues over time)
    
    Requires viewer access to the specified survey.
    """
    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_id, min_level='viewer')
    
    # Get config fields
    config = survey_config.config_data or {}
    core_ids = config.get("core_identifiers", {})
    enumerator_field = core_ids.get("enumerator", "enumerator_id")
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
            raise HTTPException(status_code=400, detail=f"Invalid start_date format: {start_date}. Use YYYY-MM-DD.")
    
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            # Include the entire end date by adding a day
            end_dt = end_dt.replace(hour=23, minute=59, second=59)
            query = query.filter(SubmissionCurrent._submission_time <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid end_date format: {end_date}. Use YYYY-MM-DD.")
    
    # Fetch all matching submissions
    all_submissions = query.all()
    
    # Apply JSONB-based filters (enumerator, sampling variables)
    enumerator_values = None
    if enumerator:
        enumerator_values = [e.strip() for e in enumerator.split(',') if e.strip()]
    
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
                approved_count=0, approved_percentage=0.0,
                pending_count=0, pending_percentage=0.0,
                flagged_count=0, flagged_percentage=0.0,
                rejected_count=0, rejected_percentage=0.0,
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
    
    # Calculate status summary
    total = len(submissions)
    approved_count = sum(1 for s in submissions if s.qa_status == "APPROVED")
    pending_count = sum(1 for s in submissions if s.qa_status == "PENDING_APPROVAL")
    flagged_count = sum(1 for s in submissions if s.qa_status == "FLAGGED")
    rejected_count = sum(1 for s in submissions if s.qa_status == "REJECTED")
    
    status_summary = SubmissionStatusSummary(
        total_submissions=total,
        approved_count=approved_count,
        approved_percentage=round(approved_count / total * 100, 1) if total > 0 else 0.0,
        pending_count=pending_count,
        pending_percentage=round(pending_count / total * 100, 1) if total > 0 else 0.0,
        flagged_count=flagged_count,
        flagged_percentage=round(flagged_count / total * 100, 1) if total > 0 else 0.0,
        rejected_count=rejected_count,
        rejected_percentage=round(rejected_count / total * 100, 1) if total > 0 else 0.0,
    )
    
    # Calculate quality metrics
    total_issues = 0
    submissions_with_issues = 0
    dk_percentages: List[float] = []
    issue_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"count": 0, "affected": 0})
    
    for sub in submissions:
        issues = sub.data_quality_issues or []
        issue_count = len(issues)
        total_issues += issue_count
        
        if issue_count > 0:
            submissions_with_issues += 1

        if sub.dk_percentage is not None:
            dk_percentages.append(float(sub.dk_percentage))
        
        # Count each issue type (track unique submissions per issue type)
        seen_checks = set()
        for issue in issues:
            check = issue.get("check", "unknown")
            issue_counts[check]["count"] += 1
            if check not in seen_checks:
                issue_counts[check]["affected"] += 1
                seen_checks.add(check)
    
    quality_metrics = QualityMetricsSummary(
        total_issues=total_issues,
        submissions_with_issues=submissions_with_issues,
        avg_issues_per_submission=round(total_issues / total, 2) if total > 0 else 0.0,
        avg_dk_percentage=round(sum(dk_percentages) / len(dk_percentages), 2) if dk_percentages else None,
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
    temporal_dict: Dict[str, Dict[str, int]] = defaultdict(lambda: {
        "total": 0, "approved": 0, "pending": 0, "flagged": 0, "rejected": 0, "issues": 0
    })
    issue_time_dict: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    
    for sub in submissions:
        date_str = sub._submission_time.strftime("%Y-%m-%d")
        temporal_dict[date_str]["total"] += 1
        
        if sub.qa_status == "APPROVED":
            temporal_dict[date_str]["approved"] += 1
        elif sub.qa_status == "PENDING_APPROVAL":
            temporal_dict[date_str]["pending"] += 1
        elif sub.qa_status == "FLAGGED":
            temporal_dict[date_str]["flagged"] += 1
        elif sub.qa_status == "REJECTED":
            temporal_dict[date_str]["rejected"] += 1
        
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
            pending_count=temporal_dict[date]["pending"],
            flagged_count=temporal_dict[date]["flagged"],
            rejected_count=temporal_dict[date]["rejected"],
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

"""
The quality dashboard's numbers, from a list of submissions.

Pure arithmetic: which submissions to include is the caller's business (see
routers/quality.py and services/submission_filters.py).
"""

import contextlib
from collections import defaultdict

from database.models import SubmissionCurrent
from models import (
    IssueFrequency,
    IssueTimeSeriesPoint,
    QualityMetricsSummary,
    QualityOverviewResponse,
    SubmissionStatusSummary,
    TemporalDataPoint,
)


def quality_overview(submissions: list[SubmissionCurrent]) -> QualityOverviewResponse:
    """Status breakdown, quality metrics, issue frequency and daily trends."""
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
            with contextlib.suppress(ValueError, TypeError):
                active_durations.append(float(active_time))

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

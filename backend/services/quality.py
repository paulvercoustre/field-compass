"""
The quality dashboard's numbers, from a list of submissions.

Pure arithmetic: which submissions to include is the caller's business (see
routers/quality.py and services/submission_filters.py).
"""

from collections import defaultdict
from typing import Any

from database.models import SubmissionCurrent
from schemas import (
    IssueFrequency,
    IssueTimeSeriesPoint,
    QualityOverviewResponse,
    TemporalDataPoint,
)
from services.metrics import counts, summarise


def quality_overview(
    submissions: list[SubmissionCurrent], config_data: dict[str, Any] | None
) -> QualityOverviewResponse:
    """The named counts and measurements, issue frequency and daily trends."""
    summary = summarise(submissions, config_data)
    total = summary.submissions

    # Each check: how often it fired, and on how many submissions.
    issue_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"count": 0, "affected": 0})
    for sub in submissions:
        seen_checks = set()
        for issue in sub.data_quality_issues or []:
            check = issue.get("check", "unknown")
            issue_counts[check]["count"] += 1
            if check not in seen_checks:
                issue_counts[check]["affected"] += 1
                seen_checks.add(check)

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

    # By the day each submission was collected, as it stands now.
    by_date: dict[str, list[SubmissionCurrent]] = defaultdict(list)
    for sub in submissions:
        by_date[sub._submission_time.strftime("%Y-%m-%d")].append(sub)
    sorted_dates = sorted(by_date)

    temporal_data = [TemporalDataPoint(date=date, **counts(by_date[date])) for date in sorted_dates]

    issue_time_series = []
    for date in sorted_dates:
        per_check: dict[str, int] = defaultdict(int)
        for sub in by_date[date]:
            for issue in sub.data_quality_issues or []:
                per_check[issue.get("check", "unknown")] += 1
        issue_time_series.append(IssueTimeSeriesPoint(date=date, issue_counts=dict(per_check)))

    return QualityOverviewResponse(
        summary=summary,
        issue_frequency=issue_frequency,
        temporal_data=temporal_data,
        issue_time_series=issue_time_series,
        date_range={
            "start": sorted_dates[0] if sorted_dates else "",
            "end": sorted_dates[-1] if sorted_dates else "",
        },
    )

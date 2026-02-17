"""
Pydantic models for API request/response validation.
These models match the frontend TypeScript types.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


# ============================================================================
# QA Status Enum
# ============================================================================

class QAStatus(str, Enum):
    """Field Compass QA status values."""
    PENDING_APPROVAL = "PENDING_APPROVAL"  # Passes HFC checks, waiting for approval in Kobo
    FLAGGED = "FLAGGED"  # Has HFC issues that need to be fixed
    APPROVED = "APPROVED"  # Approved in KoboToolbox
    REJECTED = "REJECTED"  # Rejected/Not Approved in KoboToolbox


# ============================================================================
# Quality Issue Models
# ============================================================================

class QualityIssue(BaseModel):
    check: str = Field(..., description="Type of check that flagged this issue")
    field: str = Field(..., description="Field name where issue was found")
    value: Any = Field(..., description="Value that triggered the issue")
    message: str = Field(..., description="Human-readable issue message")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata for the issue (e.g., statistical bounds for outliers)")


# ============================================================================
# Submission Models
# ============================================================================

class Submission(BaseModel):
    # Use validation_alias to allow underscore-prefixed field names from Kobo
    id: int = Field(..., description="KoboToolbox submission ID (stable primary key)", validation_alias="_id", serialization_alias="_id")
    uuid: str = Field(..., description="KoboToolbox UUID", validation_alias="_uuid", serialization_alias="_uuid")
    submission_time: datetime = Field(..., description="Original submission timestamp", validation_alias="_submission_time", serialization_alias="_submission_time")
    end: datetime = Field(..., description="End timestamp (used for edit detection)")
    submission_data: Dict[str, Any] = Field(..., description="Complete submission data as JSON")
    is_edited: bool = Field(default=False, description="Whether submission needs validation due to recent edit")
    has_edit_history: bool = Field(default=False, description="Whether submission was ever edited (permanent audit flag)")
    data_quality_issues: List[QualityIssue] = Field(
        default_factory=list, description="Array of quality issues found"
    )
    qa_status: str = Field(..., description="Current QA status")
    kobo_validation_status: Optional[str] = Field(None, description="KoboToolbox validation status (Approved, Not Approved, On Hold, etc.)")
    kobo_edit_url: Optional[str] = Field(None, description="URL to view/edit this submission in KoboToolbox")
    reviewer_notes: Optional[str] = Field(None, description="Optional reviewer notes for this submission")
    llm_check_status: Optional[str] = Field(None, description="Qualitative LLM check status")
    llm_job_id: Optional[str] = Field(None, description="Background job ID for qualitative checks")
    llm_queued_at: Optional[datetime] = Field(None, description="When qualitative checks were queued")
    llm_started_at: Optional[datetime] = Field(None, description="When qualitative checks started")
    llm_checked_at: Optional[datetime] = Field(None, description="When qualitative checks completed")
    llm_last_error: Optional[str] = Field(None, description="Last qualitative check error message")

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "_id": 1001,
                "_uuid": "uuid-1001-v2",
                "_submission_time": "2023-10-26T10:00:00Z",
                "end": "2023-10-27T14:35:10Z",
                "submission_data": {
                    "name": "John Doe",
                    "age": 99,
                    "income": 150000
                },
                "is_edited": True,
                "data_quality_issues": [
                    {
                        "check": "Outlier",
                        "field": "age",
                        "value": 99,
                        "message": "Age 99 is above the 95th percentile (90)."
                    }
                ],
                "qa_status": "HFC_FLAGGED"
            }
        }
    )


class ValidationStatusUpdate(BaseModel):
    """Request model for updating Kobo validation status."""
    validation_status: Optional[str] = Field(
        None, 
        description="Kobo validation status: 'Approved', 'Not Approved', 'On Hold', or null to clear"
    )


class ReviewerNotesUpdate(BaseModel):
    """Request model for updating reviewer notes."""
    reviewer_notes: Optional[str] = Field(
        None,
        description="Free-text reviewer notes, or null to clear"
    )


# ============================================================================
# History Models
# ============================================================================

class JsonPatch(BaseModel):
    op: str = Field(..., description="Operation: add, remove, or replace")
    path: str = Field(..., description="JSON path to the field")
    value: Optional[Any] = Field(None, description="New value (for add/replace)")
    from_: Optional[str] = Field(None, alias="from", description="Source path (for move operations)")


class SubmissionHistory(BaseModel):
    history_id: int = Field(..., description="History record ID")
    kobo_id: int = Field(..., description="Reference to submission _id")
    timestamp: datetime = Field(..., description="When the edit occurred")
    deprecated_uuid: str = Field(..., description="Previous UUID before edit")
    data_delta: List[JsonPatch] = Field(..., description="JSON patch array showing changes")

    class Config:
        json_schema_extra = {
            "example": {
                "history_id": 201,
                "kobo_id": 1001,
                "timestamp": "2023-10-27T14:35:10Z",
                "deprecated_uuid": "uuid-1001-v1",
                "data_delta": [
                    {
                        "op": "replace",
                        "path": "/age",
                        "value": 99
                    }
                ]
            }
        }


# ============================================================================
# Progress Tracking Models
# ============================================================================

class OverallProgress(BaseModel):
    conducted: int
    target: int
    progress: float


class ProgressByColumn(BaseModel):
    """Progress for a single value within a sampling column."""
    value: str
    conducted: int
    target: int
    progress: float


class DetailedProgress(BaseModel):
    """Progress for a combination of all sampling column values."""
    values: Dict[str, str] = Field(..., description="Map of column name to value")
    target: int
    conducted: int
    progress: float


class ProgressData(BaseModel):
    overall: OverallProgress
    byColumn: Dict[str, List[ProgressByColumn]] = Field(
        default_factory=dict,
        description="Progress disaggregated by each sampling column. Key is column name, value is list of progress by column value."
    )
    detailed: List[DetailedProgress] = Field(
        default_factory=list,
        description="Detailed progress for all combinations of sampling column values"
    )
    samplingColumns: List[str] = Field(default_factory=list, description="Names of sampling columns used for disaggregation")
    
    # Legacy fields for backward compatibility (deprecated, use byColumn instead)
    byDistrict: List[ProgressByColumn] = Field(default_factory=list, description="Deprecated: Use byColumn instead")
    byLivelihood: List[ProgressByColumn] = Field(default_factory=list, description="Deprecated: Use byColumn instead")


# ============================================================================
# Enumerator Performance Models
# ============================================================================

class EnumeratorCollectionStats(BaseModel):
    id: str
    needsReview: int
    validated: int
    total: int
    percentValidated: str
    percentNeedsReview: str


class EnumeratorQualityStats(BaseModel):
    id: str
    avgActiveTime: int
    avgTotalTime: int
    avgDkRate: str
    avgIssuesPerSurvey: float


class PerformanceData(BaseModel):
    collection: List[EnumeratorCollectionStats]
    quality: List[EnumeratorQualityStats]


# ============================================================================
# API Response Models
# ============================================================================

class BaseResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None


class SubmissionListResponse(BaseModel):
    submissions: List[Submission]
    total: int
    page: int
    page_size: int


class ErrorResponse(BaseModel):
    detail: str


# ============================================================================
# Quality Overview Models
# ============================================================================

class SubmissionStatusSummary(BaseModel):
    """Summary of submission counts by Kobo validation status."""
    total_submissions: int = Field(..., description="Total number of submissions")
    approved_count: int = Field(..., description="Number of approved submissions")
    approved_percentage: float = Field(..., description="Percentage of approved submissions")
    not_approved_count: int = Field(..., description="Number of not approved submissions")
    not_approved_percentage: float = Field(..., description="Percentage of not approved submissions")
    on_hold_count: int = Field(..., description="Number of on hold submissions")
    on_hold_percentage: float = Field(..., description="Percentage of on hold submissions")
    not_reviewed_count: int = Field(..., description="Number of not reviewed submissions")
    not_reviewed_percentage: float = Field(..., description="Percentage of not reviewed submissions")


class QualityMetricsSummary(BaseModel):
    """Summary of quality issue metrics."""
    total_issues: int = Field(..., description="Total count of all quality issues")
    submissions_with_issues: int = Field(..., description="Number of submissions with at least one issue")
    avg_issues_per_submission: float = Field(..., description="Average issues per submission")
    avg_dk_percentage: Optional[float] = Field(None, description="Average DK percentage across submissions")
    avg_active_duration_minutes: Optional[float] = Field(None, description="Average active interview duration in minutes (from audit logs)")


class IssueFrequency(BaseModel):
    """Frequency of a specific issue type."""
    check: str = Field(..., description="Issue type/check name")
    count: int = Field(..., description="Number of occurrences")
    percentage: float = Field(..., description="Percentage of total submissions affected")
    affected_submissions: int = Field(..., description="Number of unique submissions affected")


class TemporalDataPoint(BaseModel):
    """Quality data aggregated by date."""
    date: str = Field(..., description="ISO date string (YYYY-MM-DD)")
    total_submissions: int = Field(..., description="Submissions on this date")
    approved_count: int = Field(default=0, description="Approved submissions on this date")
    not_approved_count: int = Field(default=0, description="Not approved submissions on this date")
    on_hold_count: int = Field(default=0, description="On hold submissions on this date")
    not_reviewed_count: int = Field(default=0, description="Not reviewed submissions on this date")
    total_issues: int = Field(default=0, description="Total issues found on this date")


class IssueTimeSeriesPoint(BaseModel):
    """Issue counts by type for a specific date."""
    date: str = Field(..., description="ISO date string (YYYY-MM-DD)")
    issue_counts: Dict[str, int] = Field(..., description="Map of check type to count")


class QualityOverviewResponse(BaseModel):
    """Complete quality overview response."""
    status_summary: SubmissionStatusSummary = Field(..., description="Submission status breakdown")
    quality_metrics: QualityMetricsSummary = Field(..., description="Quality issue metrics")
    issue_frequency: List[IssueFrequency] = Field(..., description="Issue frequency sorted by count descending")
    temporal_data: List[TemporalDataPoint] = Field(..., description="Daily aggregated status data")
    issue_time_series: List[IssueTimeSeriesPoint] = Field(..., description="Daily aggregated issues by type")
    date_range: Dict[str, str] = Field(..., description="Actual date range of the data")

"""
Pydantic schemas for API requests and responses, matching the frontend's
TypeScript types. The database tables are in database/models.py.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# ============================================================================
# QA Status Enum
# ============================================================================


# ============================================================================
# Quality Issue Models
# ============================================================================


class QualityIssue(BaseModel):
    check: str = Field(..., description="Type of check that flagged this issue")
    field: str = Field(..., description="Field name where issue was found")
    value: Any = Field(..., description="Value that triggered the issue")
    message: str = Field(..., description="Human-readable issue message")
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Additional metadata for the issue (e.g., statistical bounds for outliers)",
    )


# ============================================================================
# Submission Models
# ============================================================================


class Submission(BaseModel):
    # Use validation_alias to allow underscore-prefixed field names from Kobo
    id: int = Field(
        ...,
        description="KoboToolbox submission ID (stable primary key)",
        validation_alias="_id",
        serialization_alias="_id",
    )
    uuid: str = Field(
        ..., description="KoboToolbox UUID", validation_alias="_uuid", serialization_alias="_uuid"
    )
    submission_time: datetime = Field(
        ...,
        description="Original submission timestamp",
        validation_alias="_submission_time",
        serialization_alias="_submission_time",
    )
    end: datetime = Field(..., description="End timestamp (used for edit detection)")
    submission_data: dict[str, Any] = Field(..., description="Complete submission data as JSON")
    is_edited: bool = Field(
        default=False, description="Whether submission needs validation due to recent edit"
    )
    has_edit_history: bool = Field(
        default=False, description="Whether submission was ever edited (permanent audit flag)"
    )
    data_quality_issues: list[QualityIssue] = Field(
        default_factory=list, description="Array of quality issues found"
    )
    qa_status: str = Field(..., description="Current QA status")
    kobo_validation_status: str | None = Field(
        default=None,
        description="KoboToolbox validation status (Approved, Not Approved, On Hold, etc.)",
    )
    kobo_edit_url: str | None = Field(
        default=None, description="URL to view/edit this submission in KoboToolbox"
    )
    reviewer_notes: str | None = Field(
        default=None, description="Optional reviewer notes for this submission"
    )
    llm_check_status: str | None = Field(default=None, description="Qualitative LLM check status")
    llm_job_id: str | None = Field(
        default=None, description="Background job ID for qualitative checks"
    )
    llm_queued_at: datetime | None = Field(
        default=None, description="When qualitative checks were queued"
    )
    llm_started_at: datetime | None = Field(
        default=None, description="When qualitative checks started"
    )
    llm_checked_at: datetime | None = Field(
        default=None, description="When qualitative checks completed"
    )
    llm_last_error: str | None = Field(
        default=None, description="Last qualitative check error message"
    )
    transcript_summary: dict[str, int] | None = Field(
        default=None,
        description="Audio transcripts of this submission: count, success, failed, in_progress, no_speech",
    )

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "_id": 1001,
                "_uuid": "uuid-1001-v2",
                "_submission_time": "2023-10-26T10:00:00Z",
                "end": "2023-10-27T14:35:10Z",
                "submission_data": {"name": "John Doe", "age": 99, "income": 150000},
                "is_edited": True,
                "data_quality_issues": [
                    {
                        "check": "Outlier",
                        "field": "age",
                        "value": 99,
                        "message": "Age 99 is above the 95th percentile (90).",
                    }
                ],
                "qa_status": "FLAGGED",
            }
        },
    )


class ValidationStatusUpdate(BaseModel):
    """Request model for updating Kobo validation status."""

    validation_status: str | None = Field(
        default=None,
        description="Kobo validation status: 'Approved', 'Not Approved', 'On Hold', or null to clear",
    )


class ReviewerNotesUpdate(BaseModel):
    """Request model for updating reviewer notes."""

    reviewer_notes: str | None = Field(
        default=None, description="Free-text reviewer notes, or null to clear"
    )


# ============================================================================
# History Models
# ============================================================================


class JsonPatch(BaseModel):
    op: str = Field(..., description="Operation: add, remove, or replace")
    path: str = Field(..., description="JSON path to the field")
    value: Any | None = Field(default=None, description="New value (for add/replace)")
    old: Any | None = Field(
        default=None,
        description="Value before (replace/remove); none on edits stored before it was kept",
    )
    from_: str | None = Field(
        default=None, alias="from", description="Source path (for move operations)"
    )


class SubmissionHistory(BaseModel):
    history_id: int = Field(..., description="History record ID")
    kobo_id: int = Field(..., description="Reference to submission _id")
    timestamp: datetime = Field(..., description="When the edit occurred")
    deprecated_uuid: str = Field(..., description="Previous UUID before edit")
    data_delta: list[JsonPatch] = Field(..., description="JSON patch array showing changes")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "history_id": 201,
                "kobo_id": 1001,
                "timestamp": "2023-10-27T14:35:10Z",
                "deprecated_uuid": "uuid-1001-v1",
                "data_delta": [{"op": "replace", "path": "/age", "value": 99}],
            }
        }
    )


# ============================================================================
# Progress Tracking Models
# ============================================================================


# `target` and `progress` are nullable throughout, and null is not the same as
# zero. Zero is a target of nothing; null is no target at all. Collapsing the
# two is what made a survey with no targets report 100% complete -- the old
# code read `progress=100.0 if target == 0`, so "nothing planned" rendered as
# "everything done". The distinction has to survive to the client, which is
# also why ProgressData carries `mode` rather than leaving the client to infer
# it from a null.


class OverallProgress(BaseModel):
    conducted: int
    target: int | None = Field(
        default=None, description="Planned interviews. Null when the survey sets no targets."
    )
    progress: float | None = Field(
        default=None, description="Percent of target conducted. Null when there is no target."
    )
    days_active: int = Field(
        default=0, description="Days from the first submission to the most recent, inclusive."
    )
    submissions_per_day: float | None = Field(
        default=None,
        description="Mean submissions per active day. Null before any submission arrives.",
    )


class ProgressByColumn(BaseModel):
    """Progress for a single value within a sampling column."""

    value: str
    conducted: int
    target: int | None = None
    progress: float | None = None
    share: float | None = Field(
        default=None,
        description=(
            "Percent of all submissions falling in this value. Describes the observed "
            "distribution when there is no target to compare against."
        ),
    )


class DetailedProgress(BaseModel):
    """Progress for a combination of all sampling column values."""

    values: dict[str, str] = Field(..., description="Map of column name to value")
    target: int | None = None
    conducted: int
    progress: float | None = None


class ProgressData(BaseModel):
    mode: str = Field(
        ...,
        description=(
            "How this survey expresses targets: none, total, by_variable or uploaded. "
            "Lets a client branch on a stable string instead of inferring from nulls."
        ),
    )
    overall: OverallProgress
    byColumn: dict[str, list[ProgressByColumn]] = Field(
        default_factory=dict,
        description="Progress disaggregated by each sampling column. Key is column name, value is list of progress by column value.",
    )
    detailed: list[DetailedProgress] = Field(
        default_factory=list,
        description="Detailed progress for all combinations of sampling column values",
    )
    samplingColumns: list[str] = Field(
        default_factory=list, description="Names of sampling columns used for disaggregation"
    )
    not_approved: int = Field(
        default=0,
        description="Submissions a reviewer marked Not approved: never counted toward the target.",
    )


# ============================================================================
# Enumerator Performance Models
# ============================================================================


class DayPoint(BaseModel):
    """One day of collection."""

    day: str = Field(..., description="ISO date (YYYY-MM-DD)")
    submissions: int = 0
    flagged: int = 0
    issues: int = 0


class SubmissionSummary(BaseModel):
    """
    The named counts and measurements of a set of submissions (services/metrics.py).

    Submissions = needs_review + on_hold + clean + approved + not_approved.
    """

    submissions: int = Field(..., description="Every submission pulled, except deleted ones.")
    flagged: int = Field(..., description="At least one issue, whatever a reviewer decided.")
    issues: int = Field(..., description="Everything the checks found.")
    needs_review: int = Field(..., description="Flagged, and no decision in Kobo yet.")
    on_hold: int = Field(..., description="Marked On hold in Kobo.")
    clean: int = Field(..., description="Not flagged, and no decision in Kobo yet.")
    reviewed: int = Field(..., description="Marked Approved or Not approved in Kobo.")
    approved: int = Field(..., description="Marked Approved in Kobo.")
    not_approved: int = Field(..., description="Marked Not approved in Kobo.")
    issues_per_submission: float | None = Field(
        default=None, description="Issues ÷ submissions. Null with no submissions."
    )
    duration_minutes: float | None = Field(
        default=None,
        description=(
            "Median interview length: audit active time, else start to end (etl/duration.py). "
            "Null when no submission has either."
        ),
    )
    duration_measured: int = Field(default=0, description="Submissions with a duration.")
    duration_from_start_end: int = Field(
        default=0, description="Of those, measured from start to end: no audit time."
    )
    dk_rate: float | None = Field(
        default=None,
        description=(
            "Percent of the answers to questions that allow don't-know that are don't-know. "
            "Null when nothing could be measured."
        ),
    )
    duration_p25: float | None = Field(
        default=None, description="The quarter of durations below this: the middle half's start."
    )
    duration_p75: float | None = Field(
        default=None, description="The quarter of durations above this: the middle half's end."
    )
    checks: dict[str, int] = Field(
        default_factory=dict, description="Submissions flagged by each check, by its issue key."
    )
    first_submission: str | None = Field(default=None, description="ISO time of the first.")
    last_submission: str | None = Field(default=None, description="ISO time of the latest.")
    daily: list[DayPoint] = Field(
        default_factory=list, description="By the day collected, oldest first."
    )


class EnumeratorSummary(SubmissionSummary):
    id: str
    durations: list[float] = Field(
        default_factory=list, description="Each measured interview's minutes, for the call sheet."
    )


class SurveyFormResponse(BaseModel):
    """A Kobo project's form structure, for populating configuration UIs."""

    asset_uid: str
    asset_name: str | None = None
    # Kobo's currently deployed form version. Recorded at configuration time so
    # a later run can tell that the form changed underneath the survey.
    deployed_version_id: str | None = None
    languages: list[str] = []
    has_audit: bool | None = None
    # The form as a survey stores it (services/kobo_form.py): question and
    # choice rows, translations in `label::<language>` columns.
    survey: list[dict[str, Any]] = []
    choices: list[dict[str, Any]] = []


class KoboProject(BaseModel):
    """One survey project in the user's Kobo account, for the project picker."""

    uid: str
    name: str
    # "deployed", "draft" (never deployed) or "archived".
    status: str
    submission_count: int | None = None
    owner_username: str | None = None
    date_modified: str | None = None
    # A Field Compass survey the user can already see that reads this project,
    # so picking it twice is a visible choice rather than an accident.
    existing_survey_name: str | None = None


class UnavailableCapability(BaseModel):
    """A feature that cannot work under the current survey configuration."""

    capability: str
    reason: str
    missing_setting: str


class PerformanceData(BaseModel):
    # The whole team: every submission, so the figures match Data quality's.
    team: SubmissionSummary | None = None
    enumerators: list[EnumeratorSummary] = []
    # Submissions with no enumerator recorded: in the team's figures, but never
    # an enumerator of their own (not counted, ranked or compared as one).
    # Null when every submission has one.
    no_enumerator: SubmissionSummary | None = None
    # The survey's built-in checks that are on and off (services/survey_config
    # built_in_checks), and how many of its own rules are active.
    checks_on: list[str] = []
    checks_off: list[str] = []
    custom_checks: int = 0
    # Populated when a required setting is missing, so the client can
    # explain an empty result instead of rendering a blank chart.
    unavailable: list[UnavailableCapability] = []


# ============================================================================
# API Response Models
# ============================================================================


class BaseResponse(BaseModel):
    success: bool
    message: str
    data: dict[str, Any] | None = None


class SubmissionListResponse(BaseModel):
    submissions: list[Submission]
    total: int
    page: int
    page_size: int
    # The review tab and the order the list is in: the defaults when none was asked for.
    review: str | None = None
    sort: str | None = None


class FacetCount(BaseModel):
    value: str
    count: int


class SamplingFacet(BaseModel):
    variable: str
    values: list[FacetCount]


class TabCounts(BaseModel):
    needs_review: int
    on_hold: int
    reviewed: int
    all: int


class CleanCounts(BaseModel):
    """Clean submissions with no decision: ready to approve, or still being checked."""

    ready: int
    waiting: int


class SubmissionFacets(BaseModel):
    """The counts behind the Submissions tabs and filter menu (services/review_queue.py)."""

    review: str
    tabs: TabCounts
    issues: list[FacetCount]
    enumerators: list[FacetCount]
    sampling: list[SamplingFacet]
    clean: CleanCounts


class ApproveCleanResult(BaseModel):
    approved: int
    failed: int


# ============================================================================
# Quality Overview Models
# ============================================================================


class IssueFrequency(BaseModel):
    """Frequency of a specific issue type."""

    check: str = Field(..., description="Issue type/check name")
    count: int = Field(..., description="Number of occurrences")
    percentage: float = Field(..., description="Percentage of total submissions affected")
    affected_submissions: int = Field(..., description="Number of unique submissions affected")


class TemporalDataPoint(BaseModel):
    """The named counts of the submissions collected on one day, as they stand now."""

    date: str = Field(..., description="ISO date string (YYYY-MM-DD)")
    submissions: int = 0
    flagged: int = 0
    issues: int = 0
    needs_review: int = 0
    on_hold: int = 0
    clean: int = 0
    approved: int = 0
    not_approved: int = 0


class IssueTimeSeriesPoint(BaseModel):
    """Issue counts by type for a specific date."""

    date: str = Field(..., description="ISO date string (YYYY-MM-DD)")
    issue_counts: dict[str, int] = Field(..., description="Map of check type to count")


class QualityOverviewResponse(BaseModel):
    """Complete quality overview response."""

    summary: SubmissionSummary = Field(..., description="The named counts and measurements")
    issue_frequency: list[IssueFrequency] = Field(
        ..., description="Issue frequency sorted by count descending"
    )
    temporal_data: list[TemporalDataPoint] = Field(..., description="Daily aggregated status data")
    issue_time_series: list[IssueTimeSeriesPoint] = Field(
        ..., description="Daily aggregated issues by type"
    )
    date_range: dict[str, str] = Field(..., description="Actual date range of the data")

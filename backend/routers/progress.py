"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from collections import defaultdict
from typing import Any
from uuid import UUID as UUIDType

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, User
from etl.dk_utils import dk_string_tokens, is_dk_value
from models import (
    DetailedProgress,
    EnumeratorCollectionStats,
    EnumeratorQualityStats,
    OverallProgress,
    PerformanceData,
    ProgressByColumn,
    ProgressData,
    UnavailableCapability,
)
from services.auth import get_current_active_user
from services.database import get_db
from services.permissions import require_survey_access
from services.survey_config import (
    CAPABILITY_ENUMERATOR_PERFORMANCE,
    SAMPLING_MODE_BY_VARIABLE,
    SAMPLING_MODE_TOTAL,
    SAMPLING_MODE_UPLOADED,
    get_enumerator_field,
    get_frame_data,
    get_sampling_cols,
    get_sampling_mode,
    get_sampling_variable,
    get_targets_by_value,
    get_total_target,
    has_targets,
    unavailable_capabilities,
)

router = APIRouter()

# Target column names that don't need to match Kobo variables
TARGET_COLUMN_NAMES = [
    "target",
    "target_interviews",
    "target_interview",
    "target_count",
    "target_number",
    "interviews_target",
    "interview_target",
    "total_target",
    "expected_interviews",
    "expected_count",
    "sample_size",
    "sample_size_target",
]


def _is_target_column(column_name: str) -> bool:
    """Check if a column name is a target column."""
    normalized = column_name.lower().strip()
    return any(name in normalized for name in TARGET_COLUMN_NAMES)


def _get_field_value(submission_data: dict[str, Any], field_name: str) -> Any:
    """
    Get field value from submission data, handling Kobo path-based field names.

    Kobo stores fields with full paths like 'module/variable', but config may only
    specify 'variable'. This function searches for the field by:
    1. Direct lookup (exact match)
    2. Path-based search (field name at end of path)

    Args:
        submission_data: Submission data dictionary
        field_name: Field name from config (may be just the variable name)

    Returns:
        Field value or None if not found
    """
    # First try direct lookup
    if field_name in submission_data:
        return submission_data[field_name]

    # Search for fields that end with the field name (path-based)
    # e.g., 'sampling_admin2' should match 'sampling_information/sampling_admin2'
    for key in submission_data.keys():
        if key.endswith(f"/{field_name}") or key == field_name:
            return submission_data[key]

    # Not found
    return None


def _extract_sampling_cols(
    submission_data: dict[str, Any], sampling_cols: list[str]
) -> dict[str, Any]:
    """Extract sampling frame columns from submission data."""
    result = {}
    for col in sampling_cols:
        result[col] = _get_field_value(submission_data, col)
    return result


def _percentage(conducted: int, target: int | None) -> float | None:
    """
    Percent of target conducted, or None when there is nothing to divide by.

    None, not 0 and not 100. The old code read
    `100.0 if target == 0 else ...`, so a survey with no targets divided by a
    total of zero and reported **100% complete** on its first submission --
    "nothing planned" rendering as "everything done". A target of zero is
    equally undividable, and gets the same answer: we do not know.
    """
    if not target or target <= 0:
        return None
    return round((conducted / target) * 100, 1)


def _collection_rate(submissions: list[SubmissionCurrent]) -> tuple[int, float | None]:
    """
    Days of collection so far, and the mean submissions per day.

    This is what a survey with no targets can honestly report instead of a
    percentage: not how much of a plan is done, but how fast data is arriving.

    Spans the first submission to the most recent inclusive, so a single day of
    collection is 1 day and not 0 -- which would divide by zero, and is also
    just wrong.
    """
    times = [sub._submission_time for sub in submissions if sub._submission_time is not None]
    if not times:
        return 0, None

    span_days = (max(times).date() - min(times).date()).days + 1
    return span_days, round(len(submissions) / span_days, 1)


def _calculate_targets_from_frame(
    frame_data: list[dict[str, Any]], sampling_cols: list[str], target_column: str | None = None
) -> tuple[
    int,
    dict[str, dict[str, int]],
    dict[tuple[str, ...], int],
    dict[tuple[str, ...], dict[str, str]],
]:
    """
    Calculate targets from sampling frame data.

    Returns:
        - total_target: Sum of all target values
        - targets_by_col: Dict mapping column_name -> value -> target count
        - targets_by_combo: Dict mapping (col1_value, col2_value, ...) -> target count
        - combo_values_map: Dict mapping combo tuple to dict of column -> value
    """
    total_target = 0
    targets_by_col: dict[str, dict[str, int]] = {col: defaultdict(int) for col in sampling_cols}
    targets_by_combo: dict[tuple, int] = defaultdict(int)
    combo_values_map: dict[tuple[str, ...], dict[str, str]] = {}

    if not frame_data:
        return (
            total_target,
            {col: dict(targets_by_col[col]) for col in sampling_cols},
            dict(targets_by_combo),
            combo_values_map,
        )

    # Find target column if not provided
    if not target_column and frame_data:
        frame_headers = list(frame_data[0].keys())
        for header in frame_headers:
            if _is_target_column(header):
                target_column = header
                break

    # Aggregate targets from frame data
    for row in frame_data:
        # Get target value (default to 1 if no target column)
        target_value = 1
        if target_column and target_column in row:
            try:
                target_value = int(float(row[target_column]))  # Handle numeric strings
            except (ValueError, TypeError):
                target_value = 1

        total_target += target_value

        # Aggregate by each sampling column
        for col in sampling_cols:
            if col in row:
                col_value = str(row[col]) if row[col] is not None else "Unknown"
                targets_by_col[col][col_value] += target_value
            else:
                targets_by_col[col]["Unknown"] += target_value

        # Aggregate by combination of all sampling columns
        combo_key = tuple(
            str(row.get(col, "Unknown")) if row.get(col) is not None else "Unknown"
            for col in sampling_cols
        )
        targets_by_combo[combo_key] += target_value
        combo_values_map[combo_key] = {
            col: (str(row.get(col)) if row.get(col) is not None else "Unknown")
            for col in sampling_cols
        }

    return (
        total_target,
        {col: dict(targets_by_col[col]) for col in sampling_cols},
        dict(targets_by_combo),
        combo_values_map,
    )


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(
    survey_id: str = Query(..., description="Survey ID (UUID) - required"),
    approved_only: bool = Query(
        False,
        description="When true, only count submissions whose qa_status is APPROVED.",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get data collection progress metrics for a specific survey.
    Requires viewer access to the survey.

    Returns overall progress, by sampling column disaggregations, and detailed breakdown.

    Progress is calculated by counting completed surveys (submissions) against targets
    from the sampling frame. Disaggregations are dynamically generated based on
    the sampling_cols in the survey configuration.

    Submissions included:
    - approved_only=False (default): all submissions except REJECTED (Not accepted).
    - approved_only=True: only submissions with qa_status APPROVED.
    """
    # Parse and validate survey_id
    try:
        survey_uuid = UUIDType(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )

    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level="viewer")

    # Build query filtered by survey
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )

    # Filter submissions by qa_status
    if approved_only:
        query = query.filter(SubmissionCurrent.qa_status == "APPROVED")
    else:
        # Default: exclude REJECTED (Not accepted)
        query = query.filter(SubmissionCurrent.qa_status != "REJECTED")

    # Get all submissions (completed surveys)
    submissions = query.all()

    config = survey_config.config_data if survey_config else None
    mode = get_sampling_mode(config)
    sampling_cols = get_sampling_cols(config)
    sampling_variable = get_sampling_variable(config)
    frame_data = get_frame_data(config)
    targets_available = has_targets(config)

    target_column = None
    if frame_data:
        # Find target column from frame headers if available
        frame_headers = list(frame_data[0].keys())
        for header in frame_headers:
            if _is_target_column(header):
                target_column = header
                break

    # Calculate targets from sampling frame. In every mode but `uploaded` this
    # returns empty structures, which is what makes the per-column and detailed
    # sections below fall through to describing what was collected.
    (
        frame_total_target,
        targets_by_col,
        targets_by_combo,
        targets_combo_values,
    ) = _calculate_targets_from_frame(frame_data, sampling_cols, target_column)

    total_conducted = len(submissions)

    # Per-value targets, in the one mode that has them without a file. Read
    # once here rather than per column: the same dict answers the overall
    # total, the per-value rows and the detailed rows.
    targets_by_value = get_targets_by_value(config) if mode == SAMPLING_MODE_BY_VARIABLE else {}

    if not targets_available:
        total_target = None
    elif mode == SAMPLING_MODE_TOTAL:
        total_target = get_total_target(config)
    elif mode == SAMPLING_MODE_BY_VARIABLE:
        total_target = sum(targets_by_value.values())
    else:
        total_target = frame_total_target

    days_active, submissions_per_day = _collection_rate(submissions)

    overall = OverallProgress(
        conducted=total_conducted,
        target=total_target,
        progress=_percentage(total_conducted, total_target),
        days_active=days_active,
        submissions_per_day=submissions_per_day,
    )

    # Group by each sampling column dynamically
    by_column: dict[str, list[ProgressByColumn]] = {}

    for col in sampling_cols:
        col_counts = defaultdict(int)

        # Count conducted surveys for each value in this column
        for sub in submissions:
            col_value = _get_field_value(sub.submission_data, col) or "Unknown"
            col_value = str(col_value) if col_value is not None else "Unknown"
            col_counts[col_value] += 1

        # Where this column's targets come from. A single total cannot be split
        # across values without inventing an allocation, so `total` mode
        # contributes none -- the overall percentage is the honest limit of what
        # one number supports.
        if mode == SAMPLING_MODE_UPLOADED:
            col_targets = targets_by_col.get(col, {})
        elif mode == SAMPLING_MODE_BY_VARIABLE and col == sampling_variable:
            col_targets = targets_by_value
        else:
            col_targets = {}

        # Build progress list for this column ensuring targets with zero conducted are included
        all_values = set(col_counts.keys()) | set(col_targets.keys())
        column_progress = []
        for col_value in sorted(all_values):
            conducted = col_counts.get(col_value, 0)
            target = col_targets.get(col_value) if col_targets else None
            column_progress.append(
                ProgressByColumn(
                    value=str(col_value),
                    conducted=conducted,
                    target=target,
                    progress=_percentage(conducted, target),
                    share=_percentage(conducted, total_conducted),
                )
            )

        by_column[col] = column_progress

    # Detailed breakdown (all sampling columns combined)
    detailed = []
    if sampling_cols and len(sampling_cols) > 0:
        combo_counts = defaultdict(int)
        combo_values_map = {}

        # Group submissions by all sampling column values
        for sub in submissions:
            combo_values = {}
            combo_key_parts = []

            for col in sampling_cols:
                col_value = _get_field_value(sub.submission_data, col) or "Unknown"
                col_value = str(col_value) if col_value is not None else "Unknown"
                combo_values[col] = col_value
                combo_key_parts.append(col_value)

            combo_key = tuple(combo_key_parts)
            combo_counts[combo_key] += 1
            # Store values dict for this combination (only need to store once per unique combo)
            if combo_key not in combo_values_map:
                combo_values_map[combo_key] = combo_values

        # Include combinations from frame even if no submissions. Without a
        # frame there is nothing to add: the observed combinations are the
        # whole story, and a row for a combination nobody planned would be
        # invented.
        if mode == SAMPLING_MODE_UPLOADED:
            frame_combos = targets_by_combo
        elif mode == SAMPLING_MODE_BY_VARIABLE:
            # One sampling column, so a "combination" is a single value.
            frame_combos = {(value,): target for value, target in targets_by_value.items()}
        else:
            frame_combos = {}
        all_combo_keys = set(combo_counts.keys()) | set(frame_combos.keys())

        # Build detailed progress entries
        for combo_key in sorted(all_combo_keys):
            conducted = combo_counts.get(combo_key, 0)
            target = frame_combos.get(combo_key) if frame_combos else None

            # Get the values dict for this combination
            # `targets_combo_values` is built from an uploaded frame. In
            # by_variable mode the combination is a single choice value, so it
            # maps back to the one sampling column directly -- without this a
            # value that has a target but no submissions yet would render as
            # "Unknown" rather than by its own name.
            by_variable_values = (
                {sampling_variable: combo_key[0]}
                if mode == SAMPLING_MODE_BY_VARIABLE and sampling_variable and combo_key
                else None
            )
            values_dict = (
                combo_values_map.get(combo_key)
                or targets_combo_values.get(combo_key)
                or by_variable_values
                or {col: "Unknown" for col in sampling_cols}
            )

            detailed.append(
                DetailedProgress(
                    values=values_dict,
                    conducted=conducted,
                    target=target,
                    progress=_percentage(conducted, target),
                )
            )

    # Build legacy fields for backward compatibility
    by_district = by_column.get(sampling_cols[0], []) if sampling_cols else []
    by_livelihood = by_column.get(sampling_cols[1], []) if len(sampling_cols) > 1 else []

    return ProgressData(
        mode=mode,
        overall=overall,
        byColumn=by_column,
        detailed=detailed,
        samplingColumns=sampling_cols,
        byDistrict=by_district,  # Legacy
        byLivelihood=by_livelihood,  # Legacy
    )


@router.get("/performance", response_model=PerformanceData)
async def get_performance_data(
    survey_id: str = Query(..., description="Survey ID (UUID) - required"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get enumerator performance metrics for a specific survey.
    Requires viewer access to the survey.

    Returns collection stats and quality metrics per enumerator.

    Quality metrics include:
    - avgActiveTime: Average active interview time (minutes) from audit logs
    - avgTotalTime: Average total duration (minutes) from audit logs
    - avgDkRate: Average percentage of "Don't Know" values per submission
    - avgIssuesPerSurvey: Average number of quality issues per submission

    Note: Active time and total time metrics require audit logs to be processed
    during ETL. If audit logs are not available, these values will be 0.

    Args:
        survey_id: Required survey ID (UUID) to filter submissions

    Raises:
        HTTPException: 400 if survey_id is invalid, 403 if no access, 404 if survey not found
    """
    # Parse and validate survey_id
    try:
        survey_uuid = UUIDType(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )

    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level="viewer")

    # Get enumerator field name from survey config
    config = survey_config.config_data
    enumerator_field = get_enumerator_field(config)

    # No enumerator configured: return an empty result carrying the reason,
    # rather than bucketing every submission under a phantom "Unknown"
    # enumerator that reads as real data.
    if not enumerator_field:
        return PerformanceData(
            collection=[],
            quality=[],
            unavailable=[
                UnavailableCapability(**item)
                for item in unavailable_capabilities(config)
                if item["capability"] == CAPABILITY_ENUMERATOR_PERFORMANCE
            ],
        )

    # Build query filtered by survey_id
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    submissions = query.all()

    # Get DK values from survey config for DK rate calculation
    special_values = config.get("special_values", {})
    dk_value = special_values.get("dk_value")
    # Shared with the ETL rather than compared here, so both read the same
    # strings the same way. This screen used to do its own raw `==`, which
    # missed case differences and `select_multiple` answers the ETL counted.
    dk_tokens = dk_string_tokens(special_values)

    # Aggregate by enumerator
    enum_collection_stats = defaultdict(
        lambda: {
            "needsReview": 0,
            "validated": 0,
            "total": 0,
            "total_issues": 0,
            "active_times": [],  # List of active_interview_time values (minutes)
            "total_times": [],  # List of total_duration values (minutes)
            "dk_rates": [],  # List of DK rates per submission (percentage)
        }
    )

    def _count_dk_values(
        submission_data: dict[str, Any], dk_value: Any, dk_tokens: set[str]
    ) -> tuple[int, int]:
        """
        Count DK values in submission data.

        Returns:
            Tuple of (dk_count, total_field_count)
        """
        dk_count = 0
        total_count = 0

        def _check_value(value: Any) -> bool:
            return is_dk_value(value, dk_value, dk_tokens)

        def _traverse_dict(data: dict[str, Any], path: str = ""):
            """Recursively traverse dictionary to count fields."""
            nonlocal dk_count, total_count

            for key, value in data.items():
                current_path = f"{path}.{key}" if path else key

                if isinstance(value, dict):
                    # Recursively process nested dictionaries
                    _traverse_dict(value, current_path)
                elif isinstance(value, list):
                    # Process list items
                    for i, item in enumerate(value):
                        if isinstance(item, dict):
                            _traverse_dict(item, f"{current_path}[{i}]")
                        else:
                            total_count += 1
                            if _check_value(item):
                                dk_count += 1
                else:
                    # Leaf value
                    total_count += 1
                    if _check_value(value):
                        dk_count += 1

        _traverse_dict(submission_data)
        return dk_count, total_count

    for sub in submissions:
        enum_id = _get_field_value(sub.submission_data, enumerator_field) or "Unknown"
        enum_id = str(enum_id) if enum_id else "Unknown"

        enum_collection_stats[enum_id]["total"] += 1

        if sub.qa_status in ["FLAGGED", "PENDING_RE_QA"]:
            enum_collection_stats[enum_id]["needsReview"] += 1
        elif sub.qa_status == "APPROVED":
            enum_collection_stats[enum_id]["validated"] += 1

        # Count issues
        if sub.data_quality_issues:
            enum_collection_stats[enum_id]["total_issues"] += len(sub.data_quality_issues)

        # Extract audit log metrics from submission_data
        active_time = sub.submission_data.get("active_interview_time")
        if active_time is not None:
            try:
                active_time_float = float(active_time)
                enum_collection_stats[enum_id]["active_times"].append(active_time_float)
            except (ValueError, TypeError):
                pass  # Skip invalid values

        total_time = sub.submission_data.get("total_duration")
        if total_time is not None:
            try:
                total_time_float = float(total_time)
                enum_collection_stats[enum_id]["total_times"].append(total_time_float)
            except (ValueError, TypeError):
                pass  # Skip invalid values

        # Calculate DK rate for this submission
        if dk_value is not None or dk_tokens:
            dk_count, total_fields = _count_dk_values(sub.submission_data, dk_value, dk_tokens)
            if total_fields > 0:
                dk_rate = (dk_count / total_fields) * 100
                enum_collection_stats[enum_id]["dk_rates"].append(dk_rate)

    # Build collection stats
    collection = []
    for enum_id, stats in sorted(enum_collection_stats.items()):
        total = stats["total"]
        validated = stats["validated"]
        needs_review = stats["needsReview"]

        collection.append(
            EnumeratorCollectionStats(
                id=enum_id,
                needsReview=needs_review,
                validated=validated,
                total=total,
                percentValidated=f"{round((validated / total * 100) if total > 0 else 0, 1)}%",
                percentNeedsReview=f"{round((needs_review / total * 100) if total > 0 else 0, 1)}%",
            )
        )

    # Build quality stats with calculated metrics from audit logs
    quality = []
    for enum_id in sorted(enum_collection_stats.keys()):
        stats = enum_collection_stats[enum_id]
        total = stats["total"]
        avg_issues = round(stats["total_issues"] / total if total > 0 else 0, 2)

        # Calculate average active time (in minutes, rounded to nearest integer)
        active_times = stats["active_times"]
        avg_active_time = 0
        if active_times:
            avg_active_time = round(sum(active_times) / len(active_times))

        # Calculate average total time (in minutes, rounded to nearest integer)
        total_times = stats["total_times"]
        avg_total_time = 0
        if total_times:
            avg_total_time = round(sum(total_times) / len(total_times))

        # Calculate average DK rate (percentage)
        dk_rates = stats["dk_rates"]
        avg_dk_rate = 0.0
        if dk_rates:
            avg_dk_rate = round(sum(dk_rates) / len(dk_rates), 1)

        quality.append(
            EnumeratorQualityStats(
                id=enum_id,
                avgActiveTime=avg_active_time,
                avgTotalTime=avg_total_time,
                avgDkRate=f"{avg_dk_rate}%",
                avgIssuesPerSurvey=avg_issues,
            )
        )

    return PerformanceData(
        collection=collection,
        quality=quality,
    )

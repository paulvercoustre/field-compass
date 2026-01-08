"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID as UUIDType
from collections import defaultdict

from services.database import get_db
from services.auth import get_current_active_user
from services.permissions import require_survey_access
from database.models import SubmissionCurrent, SurveyConfig, User
from models import (
    ProgressData, PerformanceData,
    OverallProgress, ProgressByColumn, DetailedProgress,
    EnumeratorCollectionStats, EnumeratorQualityStats
)

router = APIRouter()

# Target column names that don't need to match Kobo variables
TARGET_COLUMN_NAMES = [
    'target',
    'target_interviews',
    'target_interview',
    'target_count',
    'target_number',
    'interviews_target',
    'interview_target',
    'total_target',
    'expected_interviews',
    'expected_count',
    'sample_size',
    'sample_size_target',
]


def _is_target_column(column_name: str) -> bool:
    """Check if a column name is a target column."""
    normalized = column_name.lower().strip()
    return any(name in normalized for name in TARGET_COLUMN_NAMES)


def _get_field_value(submission_data: Dict[str, Any], field_name: str) -> Any:
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
        if key.endswith(f'/{field_name}') or key == field_name:
            return submission_data[key]
    
    # Not found
    return None


def _extract_sampling_cols(submission_data: Dict[str, Any], sampling_cols: List[str]) -> Dict[str, Any]:
    """Extract sampling frame columns from submission data."""
    result = {}
    for col in sampling_cols:
        result[col] = _get_field_value(submission_data, col)
    return result


def _calculate_targets_from_frame(
    frame_data: List[Dict[str, Any]],
    sampling_cols: List[str],
    target_column: Optional[str] = None
) -> Tuple[int, Dict[str, Dict[str, int]], Dict[Tuple[str, ...], int], Dict[Tuple[str, ...], Dict[str, str]]]:
    """
    Calculate targets from sampling frame data.
    
    Returns:
        - total_target: Sum of all target values
        - targets_by_col: Dict mapping column_name -> value -> target count
        - targets_by_combo: Dict mapping (col1_value, col2_value, ...) -> target count
        - combo_values_map: Dict mapping combo tuple to dict of column -> value
    """
    total_target = 0
    targets_by_col: Dict[str, Dict[str, int]] = {col: defaultdict(int) for col in sampling_cols}
    targets_by_combo: Dict[Tuple, int] = defaultdict(int)
    combo_values_map: Dict[Tuple[str, ...], Dict[str, str]] = {}
    
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
    """
    # Parse and validate survey_id
    try:
        survey_uuid = UUIDType(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level='viewer')
    
    # Build query filtered by survey
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    
    # Filter to approved submissions if requested
    if approved_only:
        query = query.filter(SubmissionCurrent.qa_status == "APPROVED")

    # Get all submissions (completed surveys)
    submissions = query.all()
    
    # Get sampling frame configuration
    sampling_cols = []
    frame_data = []
    target_column = None
    
    if survey_config and survey_config.config_data:
        config = survey_config.config_data
        sampling_frame_config = config.get("sampling_frame", {})
        sampling_cols = sampling_frame_config.get("sampling_cols", [])
        frame_data = sampling_frame_config.get("frame_data", [])
        
        # Find target column from frame headers if available
        if frame_data and len(frame_data) > 0:
            frame_headers = list(frame_data[0].keys())
            for header in frame_headers:
                if _is_target_column(header):
                    target_column = header
                    break
    
    # Calculate targets from sampling frame
    (
        total_target,
        targets_by_col,
        targets_by_combo,
        targets_combo_values
    ) = _calculate_targets_from_frame(
        frame_data, sampling_cols, target_column
    )
    
    # Calculate overall progress
    total_conducted = len(submissions)
    overall = OverallProgress(
        conducted=total_conducted,
        target=total_target,
        progress=100.0 if total_target == 0 else round((total_conducted / total_target) * 100, 1)
    )
    
    # Group by each sampling column dynamically
    by_column: Dict[str, List[ProgressByColumn]] = {}
    
    for col in sampling_cols:
        col_counts = defaultdict(int)
        
        # Count conducted surveys for each value in this column
        for sub in submissions:
            col_value = _get_field_value(sub.submission_data, col) or "Unknown"
            col_value = str(col_value) if col_value is not None else "Unknown"
            col_counts[col_value] += 1
        
        # Get targets for this column
        col_targets = targets_by_col.get(col, {})
        
        # Build progress list for this column ensuring targets with zero conducted are included
        all_values = set(col_counts.keys()) | set(col_targets.keys())
        column_progress = []
        for col_value in sorted(all_values):
            conducted = col_counts.get(col_value, 0)
            target = col_targets.get(col_value, 0)
            column_progress.append(ProgressByColumn(
                value=str(col_value),
                conducted=conducted,
                target=target,
                progress=100.0 if target == 0 else round((conducted / target) * 100, 1)
            ))
        
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
        
        # Include combinations from frame even if no submissions
        all_combo_keys = set(combo_counts.keys()) | set(targets_by_combo.keys())

        # Build detailed progress entries
        for combo_key in sorted(all_combo_keys):
            conducted = combo_counts.get(combo_key, 0)
            target = targets_by_combo.get(combo_key, 0)

            # Get the values dict for this combination
            values_dict = combo_values_map.get(combo_key) or targets_combo_values.get(combo_key) or {
                col: "Unknown" for col in sampling_cols
            }

            detailed.append(DetailedProgress(
                values=values_dict,
                conducted=conducted,
                target=target,
                progress=100.0 if target == 0 else round((conducted / target) * 100, 1)
            ))
    
    # Build legacy fields for backward compatibility
    by_district = by_column.get(sampling_cols[0], []) if sampling_cols else []
    by_livelihood = by_column.get(sampling_cols[1], []) if len(sampling_cols) > 1 else []
    
    return ProgressData(
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
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
        )
    
    # Check user has access to this survey
    survey_config = require_survey_access(db, current_user, survey_uuid, min_level='viewer')
    
    # Get enumerator field name from survey config
    config = survey_config.config_data
    core_ids = config.get("core_identifiers", {})
    enumerator_field = core_ids.get("enumerator", "enumerator_id")
    
    # Build query filtered by survey_id
    query = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey_config.survey_id
    )
    submissions = query.all()
    
    # Get DK values from survey config for DK rate calculation
    special_values = config.get("special_values", {})
    dk_value = special_values.get("dk_value")
    dk_string_value = special_values.get("dk_string_value")
    
    # Aggregate by enumerator
    enum_collection_stats = defaultdict(lambda: {
        "needsReview": 0,
        "validated": 0,
        "total": 0,
        "total_issues": 0,
        "active_times": [],  # List of active_interview_time values (minutes)
        "total_times": [],   # List of total_duration values (minutes)
        "dk_rates": []       # List of DK rates per submission (percentage)
    })
    
    def _count_dk_values(submission_data: Dict[str, Any], dk_value: Any, dk_string_value: Any) -> Tuple[int, int]:
        """
        Count DK values in submission data.
        
        Returns:
            Tuple of (dk_count, total_field_count)
        """
        dk_count = 0
        total_count = 0
        
        def _check_value(value: Any) -> bool:
            """Check if a value is a DK value."""
            if value is None:
                return False
            if isinstance(value, (int, float)) and dk_value is not None and value == dk_value:
                return True
            if isinstance(value, str) and dk_string_value and value == dk_string_value:
                return True
            return False
        
        def _traverse_dict(data: Dict[str, Any], path: str = ""):
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
        active_time = sub.submission_data.get('active_interview_time')
        if active_time is not None:
            try:
                active_time_float = float(active_time)
                enum_collection_stats[enum_id]["active_times"].append(active_time_float)
            except (ValueError, TypeError):
                pass  # Skip invalid values
        
        total_time = sub.submission_data.get('total_duration')
        if total_time is not None:
            try:
                total_time_float = float(total_time)
                enum_collection_stats[enum_id]["total_times"].append(total_time_float)
            except (ValueError, TypeError):
                pass  # Skip invalid values
        
        # Calculate DK rate for this submission
        if dk_value is not None or dk_string_value:
            dk_count, total_fields = _count_dk_values(sub.submission_data, dk_value, dk_string_value)
            if total_fields > 0:
                dk_rate = (dk_count / total_fields) * 100
                enum_collection_stats[enum_id]["dk_rates"].append(dk_rate)
    
    # Build collection stats
    collection = []
    for enum_id, stats in sorted(enum_collection_stats.items()):
        total = stats["total"]
        validated = stats["validated"]
        needs_review = stats["needsReview"]
        
        collection.append(EnumeratorCollectionStats(
            id=enum_id,
            needsReview=needs_review,
            validated=validated,
            total=total,
            percentValidated=f"{round((validated / total * 100) if total > 0 else 0, 1)}%",
            percentNeedsReview=f"{round((needs_review / total * 100) if total > 0 else 0, 1)}%"
        ))
    
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
        
        quality.append(EnumeratorQualityStats(
            id=enum_id,
            avgActiveTime=avg_active_time,
            avgTotalTime=avg_total_time,
            avgDkRate=f"{avg_dk_rate}%",
            avgIssuesPerSurvey=avg_issues
        ))
    
    return PerformanceData(
        collection=collection,
        quality=quality,
    )

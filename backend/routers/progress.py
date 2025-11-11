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
from database.models import SubmissionCurrent, SurveyConfig
from models import (
    ProgressData, PerformanceData,
    OverallProgress, ProgressByDistrict, ProgressByLivelihood, DetailedProgress,
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


def _get_survey_config(db: Session, survey_id: Optional[str]) -> Optional[SurveyConfig]:
    """Get survey configuration, optionally filtered by survey_id."""
    if survey_id:
        try:
            survey_uuid = UUIDType(survey_id)
            return db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
            )
    return None


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
) -> Tuple[int, Dict[str, int], Dict[Tuple, int]]:
    """
    Calculate targets from sampling frame data.
    
    Returns:
        - total_target: Sum of all target values
        - targets_by_col: Dict mapping column_name -> value -> target count
        - targets_by_combo: Dict mapping (col1_value, col2_value, ...) -> target count
    """
    total_target = 0
    targets_by_col: Dict[str, Dict[str, int]] = {col: defaultdict(int) for col in sampling_cols}
    targets_by_combo: Dict[Tuple, int] = defaultdict(int)
    
    if not frame_data:
        return total_target, {col: dict(targets_by_col[col]) for col in sampling_cols}, dict(targets_by_combo)
    
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
        
        # Aggregate by combination of all sampling columns
        combo_key = tuple(
            str(row.get(col, "Unknown")) if row.get(col) is not None else "Unknown"
            for col in sampling_cols
        )
        targets_by_combo[combo_key] += target_value
    
    return total_target, {col: dict(targets_by_col[col]) for col in sampling_cols}, dict(targets_by_combo)


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    db: Session = Depends(get_db),
):
    """
    Get data collection progress metrics.
    Returns overall progress, by sampling column disaggregations, and detailed breakdown.
    
    Progress is calculated by counting completed surveys (submissions) against targets
    from the sampling frame. Disaggregations are dynamically generated based on
    the sampling_cols in the survey configuration.
    """
    # Build base query
    query = db.query(SubmissionCurrent)
    
    # Filter by survey if provided
    survey_config = _get_survey_config(db, survey_id)
    if survey_config:
        query = query.filter(SubmissionCurrent.survey_id == survey_config.survey_id)
    
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
    total_target, targets_by_col, targets_by_combo = _calculate_targets_from_frame(
        frame_data, sampling_cols, target_column
    )
    
    # Calculate overall progress
    total_conducted = len(submissions)
    overall = OverallProgress(
        conducted=total_conducted,
        target=total_target,
        progress=100.0 if total_target == 0 else round((total_conducted / total_target) * 100, 1)
    )
    
    # Group by first sampling column (typically district/admin level)
    by_district = []
    if sampling_cols and len(sampling_cols) > 0:
        first_col = sampling_cols[0]
        col_counts = defaultdict(int)
        
        for sub in submissions:
            col_value = _get_field_value(sub.submission_data, first_col) or "Unknown"
            col_value = str(col_value) if col_value is not None else "Unknown"
            col_counts[col_value] += 1
        
        # Get targets for this column
        col_targets = targets_by_col.get(first_col, {})
        
        for col_value, conducted in sorted(col_counts.items()):
            target = col_targets.get(col_value, 0)
            by_district.append(ProgressByDistrict(
                district=str(col_value),
                conducted=conducted,
                target=target,
                progress=100.0 if target == 0 else round((conducted / target) * 100, 1)
            ))
    
    # Group by second sampling column (typically livelihood, if exists)
    by_livelihood = []
    if sampling_cols and len(sampling_cols) > 1:
        second_col = sampling_cols[1]
        col_counts = defaultdict(int)
        
        for sub in submissions:
            col_value = _get_field_value(sub.submission_data, second_col) or "Unknown"
            col_value = str(col_value) if col_value is not None else "Unknown"
            col_counts[col_value] += 1
        
        # Get targets for this column
        col_targets = targets_by_col.get(second_col, {})
        
        for col_value, conducted in sorted(col_counts.items()):
            target = col_targets.get(col_value, 0)
            by_livelihood.append(ProgressByLivelihood(
                livelihood=str(col_value),
                conducted=conducted,
                target=target,
                progress=100.0 if target == 0 else round((conducted / target) * 100, 1)
            ))
    
    # Detailed breakdown (all sampling columns combined)
    detailed = []
    if sampling_cols and len(sampling_cols) >= 2:
        first_col = sampling_cols[0]
        second_col = sampling_cols[1]
        combo_counts = defaultdict(int)
        
        for sub in submissions:
            first_value = _get_field_value(sub.submission_data, first_col) or "Unknown"
            second_value = _get_field_value(sub.submission_data, second_col) or "Unknown"
            first_value = str(first_value) if first_value is not None else "Unknown"
            second_value = str(second_value) if second_value is not None else "Unknown"
            combo_counts[(first_value, second_value)] += 1
        
        # Get targets for combinations
        for (first_value, second_value), conducted in sorted(combo_counts.items()):
            combo_key = (first_value, second_value)
            target = targets_by_combo.get(combo_key, 0)
            detailed.append(DetailedProgress(
                district=str(first_value),
                livelihood=str(second_value),
                conducted=conducted,
                target=target,
                progress=100.0 if target == 0 else round((conducted / target) * 100, 1)
            ))
    
    return ProgressData(
        overall=overall,
        byDistrict=by_district,
        byLivelihood=by_livelihood,
        detailed=detailed,
        samplingColumns=sampling_cols,
    )


@router.get("/performance", response_model=PerformanceData)
async def get_performance_data(
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    db: Session = Depends(get_db),
):
    """
    Get enumerator performance metrics.
    Returns collection stats and quality metrics per enumerator.
    
    Note: Some metrics (active time, DK rate) require audit log processing
    which will be implemented in the ETL pipeline.
    """
    # Get survey config to find enumerator field name
    survey_config = _get_survey_config(db, survey_id)
    
    enumerator_field = "enumerator_id"  # Default
    if survey_config and survey_config.config_data:
        config = survey_config.config_data
        core_ids = config.get("core_identifiers", {})
        enumerator_field = core_ids.get("enumerator", "enumerator_id")
    
    # Build base query
    query = db.query(SubmissionCurrent)
    if survey_config:
        query = query.filter(SubmissionCurrent.survey_id == survey_config.survey_id)
    
    submissions = query.all()
    
    # Aggregate by enumerator
    enum_collection_stats = defaultdict(lambda: {
        "needsReview": 0,
        "validated": 0,
        "total": 0,
        "total_issues": 0
    })
    
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
    
    # Build quality stats (placeholder for now - requires audit log processing)
    quality = []
    for enum_id in sorted(enum_collection_stats.keys()):
        stats = enum_collection_stats[enum_id]
        total = stats["total"]
        avg_issues = round(stats["total_issues"] / total if total > 0 else 0, 2)
        
        quality.append(EnumeratorQualityStats(
            id=enum_id,
            avgActiveTime=0,  # TODO: Calculate from audit logs
            avgTotalTime=0,   # TODO: Calculate from audit logs
            avgDkRate="0%",  # TODO: Calculate from submission data
            avgIssuesPerSurvey=avg_issues
        ))
    
    return PerformanceData(
        collection=collection,
        quality=quality,
    )

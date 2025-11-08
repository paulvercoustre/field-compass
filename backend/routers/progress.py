"""
Progress tracking API endpoints.
Provides data collection progress and enumerator performance metrics.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
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


@router.get("/progress", response_model=ProgressData)
async def get_progress_data(
    survey_id: Optional[str] = Query(None, description="Filter by survey ID (UUID)"),
    db: Session = Depends(get_db),
):
    """
    Get data collection progress metrics.
    Returns overall progress, by district, by livelihood, and detailed breakdown.
    
    Note: Target values are not yet stored in database, so progress percentages
    will be calculated based on conducted interviews only. Targets need to be
    added via survey configuration or sampling frame import.
    """
    # Build base query
    query = db.query(SubmissionCurrent)
    
    # Filter by survey if provided
    survey_config = _get_survey_config(db, survey_id)
    if survey_config:
        query = query.filter(SubmissionCurrent.survey_id == survey_config.survey_id)
    
    # Get all submissions
    submissions = query.all()
    
    # Get sampling columns from survey config
    sampling_cols = []
    admin_level = None
    if survey_config and survey_config.config_data:
        config = survey_config.config_data
        sampling_frame_config = config.get("sampling_frame", {})
        sampling_cols = sampling_frame_config.get("sampling_cols", [])
        admin_level = sampling_frame_config.get("admin_level_for_label")
    
    # Calculate overall progress
    total_conducted = len(submissions)
    # TODO: Get targets from sampling frame when available
    total_target = 0  # Placeholder until sampling frame is stored in DB
    
    overall = OverallProgress(
        conducted=total_conducted,
        target=total_target,
        progress=100.0 if total_target == 0 else round((total_conducted / total_target) * 100, 1)
    )
    
    # Group by district (first sampling column, typically admin level)
    by_district = []
    if sampling_cols and len(sampling_cols) > 0:
        district_col = sampling_cols[0]
        district_counts = defaultdict(int)
        
        for sub in submissions:
            district = _get_field_value(sub.submission_data, district_col) or "Unknown"
            district_counts[district] += 1
        
        for district, conducted in sorted(district_counts.items()):
            by_district.append(ProgressByDistrict(
                district=str(district),
                conducted=conducted,
                target=0,  # TODO: Get from sampling frame
                progress=100.0  # Placeholder
            ))
    
    # Group by livelihood (second sampling column, if exists)
    by_livelihood = []
    if sampling_cols and len(sampling_cols) > 1:
        livelihood_col = sampling_cols[1]
        livelihood_counts = defaultdict(int)
        
        for sub in submissions:
            livelihood = _get_field_value(sub.submission_data, livelihood_col) or "Unknown"
            livelihood_counts[livelihood] += 1
        
        for livelihood, conducted in sorted(livelihood_counts.items()):
            by_livelihood.append(ProgressByLivelihood(
                livelihood=str(livelihood),
                conducted=conducted,
                target=0,  # TODO: Get from sampling frame
                progress=100.0  # Placeholder
            ))
    
    # Detailed breakdown (district × livelihood)
    detailed = []
    if sampling_cols and len(sampling_cols) >= 2:
        district_col = sampling_cols[0]
        livelihood_col = sampling_cols[1]
        combo_counts = defaultdict(int)
        
        for sub in submissions:
            district = _get_field_value(sub.submission_data, district_col) or "Unknown"
            livelihood = _get_field_value(sub.submission_data, livelihood_col) or "Unknown"
            combo_counts[(district, livelihood)] += 1
        
        for (district, livelihood), conducted in sorted(combo_counts.items()):
            detailed.append(DetailedProgress(
                district=str(district),
                livelihood=str(livelihood),
                conducted=conducted,
                target=0,  # TODO: Get from sampling frame
                progress=100.0  # Placeholder
            ))
    
    return ProgressData(
        overall=overall,
        byDistrict=by_district,
        byLivelihood=by_livelihood,
        detailed=detailed,
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
        
        if sub.qa_status in ["HFC_FLAGGED", "PENDING_RE_QA"]:
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

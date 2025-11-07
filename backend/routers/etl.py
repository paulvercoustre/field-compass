"""
ETL API endpoints
Endpoints for triggering and monitoring ETL pipelines.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
from uuid import UUID as UUIDType

from services.database import get_db
from etl.pipeline import ETLPipeline
from models import BaseResponse

router = APIRouter()


@router.post("/etl/run/{survey_id}", response_model=BaseResponse)
async def run_etl_pipeline(
    survey_id: str,
    background_tasks: BackgroundTasks,
    limit: Optional[int] = Query(None, description="Maximum number of submissions to process"),
    start_date: Optional[str] = Query(None, description="Only process submissions after this date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    """
    Trigger ETL pipeline for a survey.
    
    This endpoint will:
    1. Fetch submissions from KoboToolbox
    2. Merge submissions (with edit detection)
    3. Run High-Frequency Checks
    4. Update database
    
    Note: This runs synchronously. For large datasets, consider using Airflow.
    """
    try:
        # Validate survey_id
        try:
            survey_uuid = UUIDType(survey_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID."
            )
        
        # Parse start_date if provided
        start_datetime = None
        if start_date:
            try:
                start_datetime = datetime.strptime(start_date, '%Y-%m-%d')
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid date format: {start_date}. Use YYYY-MM-DD"
                )
        
        # Create pipeline
        pipeline = ETLPipeline(db)
        
        # Run pipeline
        stats = pipeline.run_pipeline(
            survey_id=survey_id,
            limit=limit,
            start_date=start_datetime
        )
        
        return BaseResponse(
            success=True,
            message=f"ETL pipeline completed successfully",
            data={
                "fetched": stats['fetched'],
                "created": stats['created'],
                "updated": stats['updated'],
                "edited": stats['edited'],
                "hfc_flagged": stats['hfc_flagged'],
                "errors": stats['errors'],
                "duration_seconds": stats.get('duration_seconds', 0)
            }
        )
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ETL pipeline failed: {str(e)}")


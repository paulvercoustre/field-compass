"""
ETL API endpoints
Endpoints for triggering and monitoring ETL pipelines.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from datetime import datetime
from uuid import UUID as UUIDType
import logging

from services.database import get_db
from services.auth import get_current_active_user, get_user_kobo_token
from services.permissions import require_survey_access
from etl.pipeline import ETLPipeline
from models import BaseResponse
from database.models import User

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/etl/run/{survey_id}", response_model=BaseResponse)
async def run_etl_pipeline(
    survey_id: str,
    background_tasks: BackgroundTasks,
    limit: int | None = Query(None, description="Maximum number of submissions to process"),
    start_date: str | None = Query(None, description="Only process submissions after this date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Trigger ETL pipeline for a survey.
    
    This endpoint will:
    1. Fetch submissions from KoboToolbox
    2. Merge submissions (with edit detection)
    3. Run High-Frequency Checks
    4. Update database
    
    Authentication required. User must:
    - Have at least 'editor' access to the survey
    - Have a Kobo API key configured
    - Have Kobo-level access to the form
    
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
        
        # Check user has editor access to this survey
        require_survey_access(db, current_user, survey_uuid, min_level='editor')
        
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
        
        # Get Kobo API credentials from user
        kobo_api_token = get_user_kobo_token(current_user)
        kobo_api_url = current_user.kobo_api_url
        
        if not kobo_api_token:
            raise HTTPException(
                status_code=400,
                detail="Kobo API key not configured. Please set your API key in user settings."
            )
        
        # Create pipeline with user's credentials
        pipeline = ETLPipeline(
            db,
            kobo_api_token=kobo_api_token,
            kobo_api_url=kobo_api_url
        )
        
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
        logger.error(f"ETL pipeline failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"ETL pipeline failed: {str(e)}")


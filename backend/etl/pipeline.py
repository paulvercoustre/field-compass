"""
ETL Pipeline
Main orchestrator for fetching, merging, and validating submissions.
"""

import logging
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime
from sqlalchemy.orm import Session
from uuid import UUID

from etl.kobo_fetcher import KoboFetcher, create_fetcher_from_env
from etl.data_merger import parse_kobo_submission, merge_submission
from etl.hfc_engine import HFCEngine
from database.models import SurveyConfig, SubmissionCurrent
from services.database import get_db

logger = logging.getLogger(__name__)


class ETLPipeline:
    """Main ETL pipeline orchestrator."""
    
    def __init__(self, db: Session, kobo_fetcher: Optional[KoboFetcher] = None):
        """
        Initialize ETL pipeline.
        
        Args:
            db: Database session
            kobo_fetcher: Optional KoboFetcher instance (will create from env if not provided)
        """
        self.db = db
        self.kobo_fetcher = kobo_fetcher or create_fetcher_from_env()
    
    def run_pipeline(
        self,
        survey_id: str,
        limit: Optional[int] = None,
        start_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Run the complete ETL pipeline for a survey.
        
        Args:
            survey_id: UUID of the survey configuration
            limit: Maximum number of submissions to process (optional)
            start_date: Only process submissions after this date (optional)
            
        Returns:
            Dictionary with pipeline statistics
        """
        # Get survey configuration
        try:
            survey_uuid = UUID(survey_id)
        except ValueError:
            raise ValueError(f"Invalid survey_id format: {survey_id}")
        
        survey_config = self.db.query(SurveyConfig).filter(
            SurveyConfig.survey_id == survey_uuid
        ).first()
        
        if not survey_config:
            raise ValueError(f"Survey configuration not found: {survey_id}")
        
        if not survey_config.kobo_asset_id:
            raise ValueError(f"Survey {survey_id} does not have a kobo_asset_id configured")
        
        logger.info(f"Starting ETL pipeline for survey: {survey_config.survey_name} (ID: {survey_id})")
        
        stats = {
            'fetched': 0,
            'created': 0,
            'updated': 0,
            'edited': 0,
            'hfc_flagged': 0,
            'errors': 0,
            'start_time': datetime.utcnow()
        }
        
        try:
            # Step 1: Fetch submissions from Kobo
            logger.info("Step 1: Fetching submissions from KoboToolbox...")
            kobo_submissions = self.kobo_fetcher.get_asset_submissions(
                asset_uid=survey_config.kobo_asset_id,
                start=start_date,
                limit=limit
            )
            stats['fetched'] = len(kobo_submissions)
            logger.info(f"Fetched {stats['fetched']} submissions from Kobo")
            
            # Step 2: Initialize HFC engine
            hfc_engine = HFCEngine(self.db, survey_config)
            
            # Step 3: Process each submission
            logger.info("Step 2: Processing submissions...")
            for kobo_sub in kobo_submissions:
                try:
                    # Parse submission
                    parsed = parse_kobo_submission(kobo_sub)
                    submission_uuid = parsed['_uuid']
                    
                    # Merge submission (upsert with edit detection)
                    submission, history, is_new = merge_submission(
                        self.db,
                        parsed,
                        survey_id,
                        threshold_seconds=300
                    )
                    
                    if is_new:
                        stats['created'] += 1
                    elif history:
                        stats['edited'] += 1
                        stats['updated'] += 1
                    else:
                        stats['updated'] += 1
                    
                    # Run HFC checks
                    issues = hfc_engine.run_checks(
                        submission_data=submission.submission_data,
                        submission_uuid=submission_uuid
                    )
                    
                    # Update submission with HFC results
                    submission.data_quality_issues = [
                        {
                            'check': issue.check,
                            'field': issue.field,
                            'value': issue.value,
                            'message': issue.message
                        }
                        for issue in issues
                    ]
                    submission.qa_status = hfc_engine.determine_qa_status(issues)
                    
                    if submission.qa_status == 'HFC_FLAGGED':
                        stats['hfc_flagged'] += 1
                    
                    self.db.commit()
                    
                except Exception as e:
                    logger.error(f"Error processing submission: {e}", exc_info=True)
                    stats['errors'] += 1
                    self.db.rollback()
                    continue
            
            stats['end_time'] = datetime.utcnow()
            stats['duration_seconds'] = (stats['end_time'] - stats['start_time']).total_seconds()
            
            logger.info(f"ETL pipeline completed. Stats: {stats}")
            
        except Exception as e:
            logger.error(f"ETL pipeline failed: {e}", exc_info=True)
            stats['errors'] += 1
            stats['end_time'] = datetime.utcnow()
            raise
        
        return stats
    
    def process_single_submission(
        self,
        survey_id: str,
        kobo_submission: Dict[str, Any]
    ) -> Tuple[SubmissionCurrent, Optional[Any], List[Any]]:
        """
        Process a single submission (for testing or manual processing).
        
        Args:
            survey_id: UUID of the survey configuration
            kobo_submission: Raw submission dictionary from Kobo API
            
        Returns:
            Tuple of (SubmissionCurrent, SubmissionHistory or None, List[QualityIssue])
        """
        # Get survey configuration
        try:
            survey_uuid = UUID(survey_id)
        except ValueError:
            raise ValueError(f"Invalid survey_id format: {survey_id}")
        
        survey_config = self.db.query(SurveyConfig).filter(
            SurveyConfig.survey_id == survey_uuid
        ).first()
        
        if not survey_config:
            raise ValueError(f"Survey configuration not found: {survey_id}")
        
        # Parse submission
        parsed = parse_kobo_submission(kobo_submission)
        submission_uuid = parsed['_uuid']
        
        # Merge submission
        submission, history, _ = merge_submission(
            self.db,
            parsed,
            survey_id,
            threshold_seconds=300
        )
        
        # Run HFC checks
        hfc_engine = HFCEngine(self.db, survey_config)
        issues = hfc_engine.run_checks(
            submission_data=submission.submission_data,
            submission_uuid=submission_uuid
        )
        
        # Update submission with HFC results
        submission.data_quality_issues = [
            {
                'check': issue.check,
                'field': issue.field,
                'value': issue.value,
                'message': issue.message
            }
            for issue in issues
        ]
        submission.qa_status = hfc_engine.determine_qa_status(issues)
        
        self.db.commit()
        
        return submission, history, issues


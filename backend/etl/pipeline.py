"""
ETL Pipeline
Main orchestrator for fetching, merging, and validating submissions.
"""

import logging
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime
import hashlib
from sqlalchemy.orm import Session
from uuid import UUID

from etl.kobo_fetcher import KoboFetcher
from etl.data_merger import parse_kobo_submission, merge_submission
from etl.hfc_engine import HFCEngine
from etl.audit_processor import download_and_process_audit
from database.models import SurveyConfig, SubmissionCurrent
from services.database import get_db
from services.ai_service import AIService
from services.qualitative_worker import run_qualitative_check_task

logger = logging.getLogger(__name__)


def _is_llm_qual_issue(issue: Dict[str, Any]) -> bool:
    """Identify stored qualitative LLM issues in mixed issue lists."""
    metadata = issue.get("metadata", {}) or {}
    return bool(
        issue.get("check", "").startswith("qual_")
        or metadata.get("source") == "llm_qualitative_v1"
    )


class ETLPipeline:
    """Main ETL pipeline orchestrator."""
    
    def __init__(
        self,
        db: Session,
        kobo_fetcher: Optional[KoboFetcher] = None,
        kobo_api_token: Optional[str] = None,
        kobo_api_url: Optional[str] = None
    ):
        """
        Initialize ETL pipeline.
        
        Args:
            db: Database session
            kobo_fetcher: Optional KoboFetcher instance
            kobo_api_token: Kobo API token (required if kobo_fetcher not provided)
            kobo_api_url: Optional Kobo API URL (defaults to kf.kobotoolbox.org)
        
        Raises:
            ValueError: If neither kobo_fetcher nor kobo_api_token is provided
        """
        self.db = db
        self.kobo_api_token = kobo_api_token
        self.kobo_api_url = kobo_api_url or 'https://kf.kobotoolbox.org/api/v2'
        
        if kobo_fetcher:
            self.kobo_fetcher = kobo_fetcher
        elif kobo_api_token:
            # Create fetcher from provided token
            self.kobo_fetcher = KoboFetcher(api_token=kobo_api_token, api_url=self.kobo_api_url)
        else:
            raise ValueError("Kobo API token is required. Please configure your API key in user settings.")
    
    def run_pipeline(
        self,
        survey_id: str,
        limit: Optional[int] = None,
        start_date: Optional[datetime] = None,
        force_validation: bool = False
    ) -> Dict[str, Any]:
        """
        Run the complete ETL pipeline for a survey.
        
        Args:
            survey_id: UUID of the survey configuration
            limit: Maximum number of submissions to process (optional)
            start_date: Only process submissions after this date (optional)
            force_validation: Force revalidation of all submissions (default: False)
                            If False, uses incremental validation (only new/edited/rule-changed)
            
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
            'validated': 0,  # NEW: Count of submissions validated
            'skipped': 0,  # NEW: Count of submissions skipped
            'validation_reasons': {},  # NEW: Reasons for validation
            'llm_queued': 0,
            'llm_skipped': 0,
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

            # Pre-compute outlier statistics for consistency across all submissions
            hfc_engine.precompute_outlier_statistics()
            
            # Compute current validation hash (do once at start of ETL run)
            current_rule_hash = hfc_engine.compute_validation_hash()
            logger.info(f"Current validation rule hash: {current_rule_hash}")
            ai_service = AIService()
            llm_rules_hash = hfc_engine.compute_llm_rules_hash(ai_service.qual_check_model)

            # Get Kobo API token for audit downloads
            kobo_token = self.kobo_api_token
            
            # Step 3: Process each submission
            logger.info("Step 2: Processing submissions...")
            for kobo_sub in kobo_submissions:
                try:
                    # Parse submission
                    parsed = parse_kobo_submission(kobo_sub)
                    submission_uuid = parsed['_uuid']
                    submission_id = parsed['_id']
                    audit_url = parsed.get('audit_url')
                    
                    # Log audit URL for debugging
                    if audit_url:
                        logger.info(f"Processing audit log for {submission_uuid}: {audit_url}")
                    else:
                        logger.debug(f"No audit URL found for submission {submission_uuid}")
                    
                    # Download and process audit log (if available)
                    audit_metrics = None
                    if audit_url:
                        try:
                            logger.debug(f"Downloading audit log from: {audit_url}")
                            audit_metrics = download_and_process_audit(
                                audit_url=audit_url,
                                uuid=submission_uuid,
                                kobo_token=kobo_token
                            )
                            if audit_metrics:
                                # Add audit metrics to submission_data
                                parsed['submission_data']['active_interview_time'] = audit_metrics.get('active_interview_time')
                                parsed['submission_data']['total_duration'] = audit_metrics.get('total_duration')
                                logger.debug(f"Added audit metrics for {submission_uuid}: active_time={audit_metrics.get('active_interview_time')} min, total_duration={audit_metrics.get('total_duration')} min")
                        except Exception as e:
                            logger.warning(f"Failed to process audit log for {submission_uuid}: {e}")
                    
                    # Merge submission (upsert with edit detection)
                    submission, history, is_new = merge_submission(
                        self.db,
                        parsed,
                        survey_id,
                        kobo_asset_id=survey_config.kobo_asset_id,
                        kobo_data=kobo_sub  # Pass raw Kobo data for deprecatedID detection
                    )
                    
                    if is_new:
                        stats['created'] += 1
                    elif history:
                        stats['edited'] += 1
                        stats['updated'] += 1
                    else:
                        stats['updated'] += 1
                    
                    # Check if validation is needed (incremental validation)
                    needs_check, reason = hfc_engine.needs_validation(submission, current_rule_hash)
                    
                    # Override with force_validation if requested
                    if force_validation and not needs_check:
                        needs_check = True
                        reason = "forced"
                    
                    if needs_check:
                        logger.info(f"Running validation for submission {submission_uuid}: {reason}")
                        
                        # Run HFC checks
                        # Note: Duration check uses audit logs (active_interview_time) or form fields (start/end)
                        # Metadata timestamps (_submission_time, end) are NOT used for duration
                        issues = hfc_engine.run_checks(
                            submission_data=submission.submission_data,
                            submission_uuid=submission_uuid
                        )

                        # Always compute/store DK metrics for validated submissions.
                        dk_count, dk_eligible_count, dk_percentage = hfc_engine.compute_dk_metrics(
                            submission.submission_data
                        )
                        submission.dk_count = dk_count
                        submission.dk_eligible_count = dk_eligible_count
                        submission.dk_percentage = round(dk_percentage, 2) if dk_percentage is not None else None
                        
                        # Update deterministic issues while preserving existing LLM qualitative issues.
                        existing_issues = submission.data_quality_issues or []
                        preserved_llm_issues = [
                            issue for issue in existing_issues if _is_llm_qual_issue(issue)
                        ]
                        deterministic_issues = [
                            {
                                'check': issue.check,
                                'field': issue.field,
                                'value': issue.value,
                                'message': issue.message,
                                'metadata': issue.metadata
                            }
                            for issue in issues
                        ]
                        submission.data_quality_issues = deterministic_issues + preserved_llm_issues
                        
                        # Determine status based on HFC issues and Kobo validation status
                        new_status = hfc_engine.determine_qa_status(
                            issues, 
                            kobo_validation_status=submission.kobo_validation_status
                        )
                        
                        # If status is None (On Hold), keep current status, otherwise update
                        if new_status is not None:
                            submission.qa_status = new_status
                        
                        # Update validation tracking
                        submission.last_validated_at = datetime.utcnow()
                        submission.validation_rule_hash = current_rule_hash
                        
                        # CRITICAL FIX: Reset is_edited flag after validation
                        # Once we've validated an edited submission, clear the flag
                        # so it won't be re-validated unless it's edited again
                        if submission.is_edited and reason == "submission_edited":
                            submission.is_edited = False
                            logger.info(f"Reset is_edited flag for submission {submission_uuid} after validation")
                        
                        stats['validated'] += 1
                        # Track reason for validation
                        stats['validation_reasons'][reason] = stats['validation_reasons'].get(reason, 0) + 1
                        
                        if submission.qa_status == 'FLAGGED':
                            stats['hfc_flagged'] += 1
                    else:
                        logger.debug(f"Skipping validation for submission {submission_uuid}: {reason}")
                        stats['skipped'] += 1

                    # Queue asynchronous qualitative checks (independent from deterministic checks)
                    current_llm_input_hash = hfc_engine.compute_llm_input_hash(submission.submission_data)
                    llm_needs_check, llm_reason = hfc_engine.needs_llm_qualitative_check(
                        submission=submission,
                        llm_rules_hash=llm_rules_hash,
                        llm_input_hash=current_llm_input_hash,
                    )

                    if llm_needs_check:
                        dedupe_key = (
                            f"{submission.survey_id}:{submission._id}:{llm_rules_hash}:{current_llm_input_hash}"
                        )
                        task_id = hashlib.sha256(dedupe_key.encode("utf-8")).hexdigest()
                        payload = {
                            "survey_id": str(submission.survey_id),
                            "submission_id": submission._id,
                            "submission_uuid": submission._uuid,
                            "llm_rules_hash": llm_rules_hash,
                            "llm_input_hash": current_llm_input_hash,
                        }
                        try:
                            async_result = run_qualitative_check_task.apply_async(
                                kwargs={"payload": payload},
                                task_id=task_id,
                            )
                            submission.llm_check_status = "pending"
                            submission.llm_job_id = async_result.id
                            submission.llm_queued_at = datetime.utcnow()
                            submission.llm_started_at = None
                            submission.llm_checked_at = None
                            submission.llm_last_error = None
                            submission.llm_rules_hash = llm_rules_hash
                            submission.llm_input_hash = current_llm_input_hash
                            submission.llm_model_used = ai_service.qual_check_model
                            stats["llm_queued"] += 1
                        except Exception as queue_error:
                            logger.error(
                                "Failed to enqueue qualitative check for submission %s: %s",
                                submission_uuid,
                                queue_error,
                                exc_info=True,
                            )
                            submission.llm_check_status = "failed"
                            submission.llm_last_error = str(queue_error)[:1000]
                            submission.llm_checked_at = datetime.utcnow()
                    else:
                        logger.debug(
                            "Skipping qualitative queue for submission %s: %s",
                            submission_uuid,
                            llm_reason,
                        )
                        stats["llm_skipped"] += 1
                    
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
        audit_url = parsed.get('audit_url')
        
        # Download and process audit log (if available)
        kobo_token = self.kobo_api_token
        if audit_url:
            try:
                audit_metrics = download_and_process_audit(
                    audit_url=audit_url,
                    uuid=submission_uuid,
                    kobo_token=kobo_token
                )
                if audit_metrics:
                    # Add audit metrics to submission_data
                    parsed['submission_data']['active_interview_time'] = audit_metrics.get('active_interview_time')
                    parsed['submission_data']['total_duration'] = audit_metrics.get('total_duration')
            except Exception as e:
                logger.warning(f"Failed to process audit log for {submission_uuid}: {e}")
        
        # Merge submission
        submission, history, _ = merge_submission(
            self.db,
            parsed,
            survey_id,
            kobo_asset_id=survey_config.kobo_asset_id,
            kobo_data=kobo_submission  # Pass raw Kobo data for deprecatedID detection
        )
        
        # Run HFC checks
        # Note: Duration check uses audit logs (active_interview_time) or form fields (start/end)
        # Metadata timestamps (_submission_time, end) are NOT used for duration
        hfc_engine = HFCEngine(self.db, survey_config)
        issues = hfc_engine.run_checks(
            submission_data=submission.submission_data,
            submission_uuid=submission_uuid
        )

        dk_count, dk_eligible_count, dk_percentage = hfc_engine.compute_dk_metrics(
            submission.submission_data
        )
        submission.dk_count = dk_count
        submission.dk_eligible_count = dk_eligible_count
        submission.dk_percentage = round(dk_percentage, 2) if dk_percentage is not None else None
        
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
        
        # Determine status based on HFC issues and Kobo validation status
        new_status = hfc_engine.determine_qa_status(
            issues,
            kobo_validation_status=submission.kobo_validation_status
        )
        if new_status is not None:
            submission.qa_status = new_status
        
        self.db.commit()
        
        return submission, history, issues


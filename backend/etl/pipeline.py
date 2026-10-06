"""
ETL Pipeline
Main orchestrator for fetching, merging, and validating submissions.
"""

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import Run, SurveyConfig
from etl.audio import is_transcription_issue
from etl.audit_processor import download_and_process_audit
from etl.data_merger import merge_submission, parse_kobo_submission
from etl.hfc_engine import HFCEngine
from etl.kobo_fetcher import KoboFetcher
from services.ai_review_queue import AIReviewQueuer
from services.qualitative_worker import run_qualitative_check_task
from services.transcription_queue import TranscriptionQueuer
from services.translation_queue import TranslationQueuer

logger = logging.getLogger(__name__)

# How often (in submissions) a pull reports its progress and checks whether
# someone asked it to stop.
_PROGRESS_EVERY = 25


def _is_llm_qual_issue(issue: dict[str, Any]) -> bool:
    """Identify stored qualitative LLM issues in mixed issue lists."""
    metadata = issue.get("metadata", {}) or {}
    return bool(
        issue.get("check", "").startswith("qual_") or metadata.get("source") == "llm_qualitative_v1"
    )


def _is_background_issue(issue: dict[str, Any]) -> bool:
    """Findings added after the pull (AI review, transcripts): kept when re-validating."""
    return _is_llm_qual_issue(issue) or is_transcription_issue(issue)


class ETLPipeline:
    """Main ETL pipeline orchestrator."""

    def __init__(
        self,
        db: Session,
        kobo_fetcher: KoboFetcher | None = None,
        kobo_api_token: str | None = None,
        kobo_api_url: str | None = None,
        run: Run | None = None,
        started_by_user_id: UUID | None = None,
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
        # The run this pull reports to, when started from the app.
        self.run = run
        self.started_by_user_id = started_by_user_id
        self.kobo_api_token = kobo_api_token
        self.kobo_api_url = kobo_api_url or "https://kf.kobotoolbox.org/api/v2"

        if kobo_fetcher:
            self.kobo_fetcher = kobo_fetcher
        elif kobo_api_token:
            # Create fetcher from provided token
            self.kobo_fetcher = KoboFetcher(api_token=kobo_api_token, api_url=self.kobo_api_url)
        else:
            raise ValueError(
                "Kobo API token is required. Please configure your API key in user settings."
            )

    def run_pipeline(
        self,
        survey_id: str,
        limit: int | None = None,
        start_date: datetime | None = None,
        force_validation: bool = False,
    ) -> dict[str, Any]:
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
            raise ValueError(f"Invalid survey_id format: {survey_id}") from None

        survey_config = (
            self.db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_uuid).first()
        )

        if not survey_config:
            raise ValueError(f"Survey configuration not found: {survey_id}")

        if not survey_config.kobo_asset_id:
            raise ValueError(f"Survey {survey_id} does not have a kobo_asset_id configured")

        logger.info(
            f"Starting ETL pipeline for survey: {survey_config.survey_name} (ID: {survey_id})"
        )

        stats = {
            "fetched": 0,
            "created": 0,
            "updated": 0,
            "edited": 0,
            "hfc_flagged": 0,
            "validated": 0,  # NEW: Count of submissions validated
            "skipped": 0,  # NEW: Count of submissions skipped
            "validation_reasons": {},  # NEW: Reasons for validation
            "llm_queued": 0,
            "llm_skipped": 0,
            "llm_paused": 0,
            "llm_not_run_allowance": 0,
            "llm_waiting": 0,
            "transcripts_queued": 0,
            "transcripts_skipped": 0,
            "transcripts_failed": 0,
            "transcripts_paused": 0,
            "errors": 0,
            "start_time": datetime.utcnow(),
        }
        run_id = self.run.run_id if self.run is not None else None

        try:
            # Step 1: Fetch submissions from Kobo
            logger.info("Step 1: Fetching submissions from KoboToolbox...")
            kobo_submissions = self.kobo_fetcher.get_asset_submissions(
                asset_uid=survey_config.kobo_asset_id, start=start_date, limit=limit
            )
            stats["fetched"] = len(kobo_submissions)
            logger.info(f"Fetched {stats['fetched']} submissions from Kobo")
            self._report(stage="checking", fetched=stats["fetched"], processed=0)

            # Step 2: Initialize HFC engine
            hfc_engine = HFCEngine(
                self.db, survey_config, fetch_live_form=self.kobo_fetcher.get_asset_info
            )

            # Pre-compute outlier statistics for consistency across all submissions
            hfc_engine.precompute_outlier_statistics()

            # Compute current validation hash (do once at start of ETL run)
            current_rule_hash = hfc_engine.compute_validation_hash()
            logger.info(f"Current validation rule hash: {current_rule_hash}")
            # AI reviews and transcriptions: decided per submission, sent
            # after each commit so a worker never sees a row before it is pending.
            ai_reviews = AIReviewQueuer(self.db, survey_config, hfc_engine, run_id=run_id)
            transcriptions = TranscriptionQueuer(
                self.db, survey_config, run_id=run_id, user_id=self.started_by_user_id
            )
            # Typed answers and transcripts already made (or taken from Kobo)
            # are translated here, or Kobo's translations taken; new
            # transcripts as soon as each is made.
            translations = TranslationQueuer(
                self.db, survey_config, run_id=run_id, user_id=self.started_by_user_id
            )

            # Get Kobo API token for audit downloads
            kobo_token = self.kobo_api_token

            # Step 3: Process each submission
            logger.info("Step 2: Processing submissions...")
            for index, kobo_sub in enumerate(kobo_submissions):
                if index and index % _PROGRESS_EVERY == 0:
                    if self._stop_requested():
                        logger.info("Pull %s stopped after %s submissions", run_id, index)
                        stats["stopped_after"] = index
                        break
                    self._report(processed=index)
                try:
                    # Parse submission
                    parsed = parse_kobo_submission(kobo_sub)
                    submission_uuid = parsed["_uuid"]
                    parsed["_id"]
                    audit_url = parsed.get("audit_url")

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
                                audit_url=audit_url, uuid=submission_uuid, kobo_token=kobo_token
                            )
                            if audit_metrics:
                                # Add audit metrics to submission_data
                                parsed["submission_data"]["active_interview_time"] = (
                                    audit_metrics.get("active_interview_time")
                                )
                                parsed["submission_data"]["total_duration"] = audit_metrics.get(
                                    "total_duration"
                                )
                                logger.debug(
                                    f"Added audit metrics for {submission_uuid}: active_time={audit_metrics.get('active_interview_time')} min, total_duration={audit_metrics.get('total_duration')} min"
                                )
                        except Exception as e:  # noqa: BLE001 -- one bad audit log must not stop the pull
                            logger.warning(
                                f"Failed to process audit log for {submission_uuid}: {e}"
                            )

                    # Merge submission (upsert with edit detection)
                    submission, history, is_new = merge_submission(
                        self.db,
                        parsed,
                        survey_id,
                        kobo_asset_id=survey_config.kobo_asset_id,
                        kobo_data=kobo_sub,  # Pass raw Kobo data for deprecatedID detection
                    )

                    if is_new:
                        stats["created"] += 1
                    elif history:
                        stats["edited"] += 1
                        stats["updated"] += 1
                    else:
                        stats["updated"] += 1

                    # Check if validation is needed (incremental validation)
                    needs_check, reason = hfc_engine.needs_validation(submission, current_rule_hash)

                    # Override with force_validation if requested
                    if force_validation and not needs_check:
                        needs_check = True
                        reason = "forced"

                    if needs_check:
                        logger.info(
                            f"Running validation for submission {submission_uuid}: {reason}"
                        )

                        # Run HFC checks
                        # Note: Duration check uses audit logs (active_interview_time) or form fields (start/end)
                        # Metadata timestamps (_submission_time, end) are NOT used for duration
                        issues = hfc_engine.run_checks(
                            submission_data=submission.submission_data,
                            submission_uuid=submission_uuid,
                        )

                        # Always compute/store DK metrics for validated submissions.
                        dk_count, dk_eligible_count, dk_percentage = hfc_engine.compute_dk_metrics(
                            submission.submission_data
                        )
                        submission.dk_count = dk_count
                        submission.dk_eligible_count = dk_eligible_count
                        submission.dk_percentage = (
                            round(dk_percentage, 2) if dk_percentage is not None else None
                        )

                        # Update deterministic issues while preserving existing LLM qualitative issues.
                        existing_issues = submission.data_quality_issues or []
                        preserved_llm_issues = [
                            issue for issue in existing_issues if _is_background_issue(issue)
                        ]
                        deterministic_issues = [
                            {
                                "check": issue.check,
                                "field": issue.field,
                                "value": issue.value,
                                "message": issue.message,
                                "metadata": issue.metadata,
                            }
                            for issue in issues
                        ]
                        submission.data_quality_issues = deterministic_issues + preserved_llm_issues

                        # Determine status from every stored issue, AI findings
                        # included, and the Kobo validation status.
                        new_status = hfc_engine.determine_qa_status(
                            submission.data_quality_issues,
                            kobo_validation_status=submission.kobo_validation_status,
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
                            logger.info(
                                f"Reset is_edited flag for submission {submission_uuid} after validation"
                            )

                        stats["validated"] += 1
                        # Track reason for validation
                        stats["validation_reasons"][reason] = (
                            stats["validation_reasons"].get(reason, 0) + 1
                        )

                        if submission.qa_status == "FLAGGED":
                            stats["hfc_flagged"] += 1
                    else:
                        logger.debug(
                            f"Skipping validation for submission {submission_uuid}: {reason}"
                        )
                        stats["skipped"] += 1

                    # Transcribe new recordings first: an AI review that reads a
                    # transcript waits for it.
                    transcript_rows = transcriptions.consider(submission)
                    if transcript_rows:
                        self.db.flush()
                        transcriptions.queue(transcript_rows)
                    translation_rows = translations.consider_submission(submission)
                    if translation_rows:
                        self.db.flush()
                        translations.queue(translation_rows)

                    # Queue the AI review (independent from deterministic checks)
                    llm_outcome = ai_reviews.consider(submission)
                    logger.debug("AI review for submission %s: %s", submission_uuid, llm_outcome)

                    self.db.commit()
                    ai_reviews.dispatch(run_qualitative_check_task)
                    transcriptions.dispatch()
                    translations.dispatch()

                except Exception as e:
                    logger.error(f"Error processing submission: {e}", exc_info=True)
                    stats["errors"] += 1
                    self.db.rollback()
                    continue

            for key, value in {
                **ai_reviews.stats,
                **transcriptions.stats,
                **translations.stats,
            }.items():
                stats[key] = stats.get(key, 0) + value

            stats["end_time"] = datetime.utcnow()
            stats["duration_seconds"] = (stats["end_time"] - stats["start_time"]).total_seconds()

            logger.info(f"ETL pipeline completed. Stats: {stats}")

        except Exception as e:
            logger.error(f"ETL pipeline failed: {e}", exc_info=True)
            stats["errors"] += 1
            stats["end_time"] = datetime.utcnow()
            raise

        return stats

    def _report(self, **values: Any) -> None:
        """Tell the run how far the pull has got."""
        if self.run is None:
            return
        from services.runs import update_stats

        stage = values.pop("stage", None)
        if stage:
            self.run.stage = stage
        update_stats(self.run, **values)
        self.db.commit()

    def _stop_requested(self) -> bool:
        if self.run is None:
            return False
        from services.runs import stop_requested

        return stop_requested(self.db, self.run.run_id)

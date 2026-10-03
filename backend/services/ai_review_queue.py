"""
Deciding, per submission, whether its AI review is queued, held back or waits.

Used by the pull for every submission it touches, and by the transcription
worker when a transcript an AI review was waiting for is ready. Jobs are only
sent after the caller commits (:meth:`AIReviewQueuer.dispatch`), so a worker
never picks one up before the row says it is pending.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AudioTranscript, SubmissionCurrent, SurveyConfig
from etl.audio import TranscriptView, ai_audio_fields, review_data
from services.ai_allowance import (
    NOT_RUN_ALLOWANCE,
    checks_remaining,
    counted_submission_ids,
    not_run_message,
)
from services.ai_providers import paused_error, survey_connection

logger = logging.getLogger(__name__)

WAITING = "waiting"


def transcript_views(db: Session, survey_id: UUID, submission_id: int) -> dict[str, TranscriptView]:
    rows = (
        db.query(AudioTranscript)
        .filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.submission_id == submission_id,
        )
        .all()
    )
    return {
        row.question_path: TranscriptView(
            question_path=row.question_path,
            status=row.status,
            text=row.text,
            language_code=row.language_code,
            language_probability=float(row.language_probability)
            if row.language_probability is not None
            else None,
            audio_seconds=float(row.audio_seconds) if row.audio_seconds is not None else None,
        )
        for row in rows
    }


class AIReviewQueuer:
    def __init__(
        self, db: Session, survey_config: SurveyConfig, engine, run_id: UUID | None = None
    ):
        from services.ai_service import AIService

        self.db = db
        self.survey = survey_config
        self.engine = engine
        self.run_id = run_id
        connection = survey_connection(db, survey_config)
        self.model = connection.check_model if connection else AIService().qual_check_model
        self.rules_hash = engine.compute_llm_rules_hash(self.model)
        # Set when the survey's own provider is paused: reviews are marked
        # failed with its error rather than queued to fail again.
        self.paused_error = paused_error(db, survey_config)
        # On the operator's key, how many reviews may still be queued; None
        # when the survey has its own provider (no Field Compass limit).
        self.allowance_left = None if connection else checks_remaining(db, survey_config.survey_id)
        # Submissions already counted this month: queueing one again is free.
        self.already_counted = (
            set() if connection else counted_submission_ids(db, survey_config.survey_id)
        )
        self.audio_fields = (
            ai_audio_fields(survey_config.config_data, engine.llm_qualitative_fields)
            if engine.flag_llm_qualitative
            else {}
        )
        self.stats: Counter = Counter()
        self._to_send: list[tuple[int, str, dict[str, Any]]] = []

    def review_input(
        self, submission: SubmissionCurrent, transcripts: dict[str, TranscriptView] | None = None
    ) -> tuple[dict[str, Any], bool]:
        """What the review reads (transcripts in place of file names), and whether it must wait."""
        if not self.audio_fields:
            return submission.submission_data, False
        if transcripts is None:
            transcripts = transcript_views(self.db, submission.survey_id, submission._id)
        return review_data(submission.submission_data, self.audio_fields, transcripts)

    def consider(
        self, submission: SubmissionCurrent, transcripts: dict[str, TranscriptView] | None = None
    ) -> str:
        """Update the submission's review status; returns what happened."""
        data, waiting = self.review_input(submission, transcripts)
        input_hash = self.engine.compute_llm_input_hash(data)
        needs, reason = self.engine.needs_llm_qualitative_check(
            submission=submission, llm_rules_hash=self.rules_hash, llm_input_hash=input_hash
        )
        now = datetime.utcnow()

        if not needs:
            self.stats["llm_skipped"] += 1
            return reason
        if waiting:
            # Hashes stay as they were, so the review is still "needed" once
            # the transcript is in.
            submission.llm_check_status = WAITING
            submission.llm_run_id = self.run_id
            submission.llm_last_error = None
            self.stats["llm_waiting"] += 1
            return WAITING
        if self.paused_error:
            submission.llm_check_status = "failed"
            submission.llm_last_error = self.paused_error
            submission.llm_checked_at = now
            submission.llm_run_id = self.run_id
            self.stats["llm_paused"] += 1
            return "paused"
        if (
            self.allowance_left is not None
            and self.allowance_left <= 0
            and submission._id not in self.already_counted
        ):
            submission.llm_check_status = NOT_RUN_ALLOWANCE
            submission.llm_last_error = not_run_message()
            submission.llm_checked_at = now
            submission.llm_run_id = self.run_id
            self.stats["llm_not_run_allowance"] += 1
            return NOT_RUN_ALLOWANCE

        dedupe_key = (
            f"{submission.survey_id}:{submission._id}:{self.rules_hash}:{input_hash}:{self.run_id}"
        )
        task_id = hashlib.sha256(dedupe_key.encode("utf-8")).hexdigest()
        payload = {
            "survey_id": str(submission.survey_id),
            "submission_id": submission._id,
            "submission_uuid": submission._uuid,
            "llm_rules_hash": self.rules_hash,
            "llm_input_hash": input_hash,
            "run_id": str(self.run_id) if self.run_id else None,
        }
        submission.llm_check_status = "pending"
        submission.llm_job_id = task_id
        submission.llm_queued_at = now
        submission.llm_started_at = None
        submission.llm_checked_at = None
        submission.llm_last_error = None
        submission.llm_rules_hash = self.rules_hash
        submission.llm_input_hash = input_hash
        submission.llm_model_used = self.model
        submission.llm_run_id = self.run_id
        self._to_send.append((submission._id, task_id, payload))
        self.stats["llm_queued"] += 1
        if self.allowance_left is not None and submission._id not in self.already_counted:
            self.allowance_left -= 1
        return "queued"

    def dispatch(self, task=None) -> int:
        """Send the jobs queued since the last call. Call after committing."""
        if not self._to_send:
            return 0
        if task is None:
            from services.qualitative_worker import run_qualitative_check_task as task

        sent = 0
        to_send, self._to_send = self._to_send, []
        for submission_id, task_id, payload in to_send:
            try:
                task.apply_async(kwargs={"payload": payload}, task_id=task_id)
                sent += 1
            except Exception as error:
                logger.error(
                    "Failed to enqueue AI review for submission %s: %s",
                    submission_id,
                    error,
                    exc_info=True,
                )
                row = (
                    self.db.query(SubmissionCurrent)
                    .filter(
                        SubmissionCurrent._id == submission_id,
                        SubmissionCurrent.survey_id == self.survey.survey_id,
                    )
                    .first()
                )
                if row is not None and row.llm_job_id == task_id:
                    row.llm_check_status = "failed"
                    row.llm_last_error = f"unavailable: Could not queue the AI review ({error})"[
                        :1000
                    ]
                    row.llm_checked_at = datetime.utcnow()
                    self.db.commit()
                self.stats["llm_queued"] -= 1
                self.stats["llm_queue_failed"] += 1
        return sent

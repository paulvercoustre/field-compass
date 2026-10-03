"""
Deciding, per submission, which recordings to transcribe, and sending jobs.

A recording is transcribed once: a later pull with the same attachment does
nothing. It is tried again when it failed for a reason that can pass (not a
bad file), was held back by the allowance, or was stopped.

A recording that already has a transcript in Kobo is never transcribed: the
pull stores Kobo's transcript instead (source "kobo"), for every audio
question, whether or not the survey transcribes it.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AIUsage, AudioTranscript, SubmissionCurrent, SurveyConfig
from etl.audio import (
    SOURCE_ELEVENLABS,
    SOURCE_KOBO,
    KoboTranscript,
    answer_filename,
    audio_questions,
    find_attachment,
    kobo_transcript,
    selected_questions,
    transcript_input_hash,
    transcription_settings,
)
from services.ai_errors import AUTH, NOT_CONFIGURED, PROVIDER_QUOTA
from services.ai_usage import TRANSCRIPTION
from services.transcription_allowance import seconds_remaining
from services.transcription_keys import client_for, resolve_transcription_key
from services.transcription_languages import normalize_language

logger = logging.getLogger(__name__)

# After ElevenLabs rejects the key or reports no credit, recordings are not
# sent again for this long: each would fail the same way.
PAUSE_AFTER_PROVIDER_FAILURE = timedelta(minutes=30)
_PAUSE_MESSAGES = {
    AUTH: "auth: ElevenLabs rejected the API key. Transcription resumes once the operator fixes it.",
    PROVIDER_QUOTA: "provider_quota: The ElevenLabs account is out of credit. Transcription resumes once it is topped up.",
}
# Failures not worth retrying on every pull: the file itself is the problem.
_FINAL_CATEGORIES = ("bad_request",)


def transcription_paused_error(db: Session, now: datetime | None = None) -> str | None:
    """
    The stored error for recordings while ElevenLabs is known to be refusing
    the operator's key, or None. Read from the last finished call.
    """
    now = now or datetime.utcnow()
    last = (
        db.query(AIUsage.outcome, AIUsage.created_at)
        .filter(
            AIUsage.feature == TRANSCRIPTION,
            AIUsage.connection_id.is_(None),
            AIUsage.outcome != "reserved",
            AIUsage.created_at >= now - PAUSE_AFTER_PROVIDER_FAILURE,
        )
        .order_by(AIUsage.created_at.desc())
        .first()
    )
    if last is None:
        return None
    return _PAUSE_MESSAGES.get(last[0])


def task_id_for(transcript_id: int, input_hash: str, run_id: UUID | None) -> str:
    key = f"transcribe:{transcript_id}:{input_hash}:{run_id}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def reset_for_transcription(
    row: AudioTranscript, run_id: UUID | None, user_id: UUID | None
) -> None:
    """Mark a row to be transcribed (again); what it held before is cleared."""
    row.status = "pending"
    row.skip_reason = None
    row.last_error = None
    row.run_id = run_id
    row.requested_by_user_id = user_id
    row.queued_at = datetime.utcnow()
    row.started_at = None
    row.finished_at = None


class TranscriptionQueuer:
    def __init__(
        self,
        db: Session,
        survey_config: SurveyConfig,
        *,
        run_id: UUID | None,
        user_id: UUID | None,
    ):
        self.db = db
        self.survey = survey_config
        self.run_id = run_id
        self.user_id = user_id
        self.settings = transcription_settings(survey_config.config_data)
        self.questions = selected_questions(survey_config.config_data, self.settings)
        # Every audio question can have a transcript in Kobo (Kobo's
        # supplement does not address repeat instances, so not those).
        self.audio = [q for q in audio_questions(survey_config.config_data) if not q.in_repeat]
        # The owner's own ElevenLabs key, or Field Compass's within the allowance.
        key = resolve_transcription_key(db, survey_config)
        client = client_for(key)
        self.available = client.available
        self.model = client.model
        self.paused_error = key.paused_error if self.questions else None
        self.has_allowance = (
            (not key.counts_against_allowance or seconds_remaining(db, survey_config.survey_id) > 0)
            if self.questions
            else False
        )
        self.stats: Counter = Counter()
        self._to_send: list[tuple[int, str, dict[str, Any]]] = []

    @property
    def active(self) -> bool:
        return bool(self.questions)

    def _needs(self, row: AudioTranscript, input_hash: str) -> bool:
        if row.input_hash != input_hash:
            return True
        if row.status == "cancelled":
            return True
        if row.status == "not_run_allowance":
            return self.has_allowance
        if row.status == "failed":
            category = (row.last_error or "").split(":", 1)[0]
            return category not in _FINAL_CATEGORIES
        return False

    def _take_from_kobo(
        self,
        existing: dict[str, AudioTranscript],
        submission: SubmissionCurrent,
        question,
        found: KoboTranscript | None,
    ) -> bool:
        """
        Keep the stored transcript in step with Kobo's: store Kobo's when it
        has one that is not ours, and forget Kobo's once it is gone there.
        Updates ``existing``; returns whether anything changed. Does not commit.
        """
        row = existing.get(question.path)
        if found is None:
            if row is not None and row.source == SOURCE_KOBO:
                # Removed in Kobo: transcribed here again, if the survey does.
                self.db.delete(row)
                del existing[question.path]
                return True
            return False
        if row is not None and row.source == SOURCE_KOBO:
            if row.text == found.text and row.kobo_language == found.language_code:
                return False
        elif row is not None:
            if row.status == "running" or (row.text or "").strip() == found.text:
                return False  # ours as sent to Kobo, or settled on the next pull
            if row.kobo_version_uuid and row.kobo_status not in ("sent", "edited_in_kobo"):
                # A newer one of ours is on its way to Kobo (or not sent);
                # sending checks first that nobody corrected ours there.
                return False
        else:
            row = AudioTranscript(
                survey_id=self.survey.survey_id,
                submission_id=submission._id,
                question_path=question.path,
            )
            self.db.add(row)
            existing[question.path] = row

        # Kobo's stands: typed there, Kobo's own, or ours corrected there.
        corrected = row.source != SOURCE_KOBO and row.kobo_version_uuid is not None
        data = submission.submission_data or {}
        filename = answer_filename(data, question)
        attachment = find_attachment(data, question, filename) if filename else None
        row.source = SOURCE_KOBO
        row.status = "success"
        row.skip_reason = None
        row.last_error = None
        row.text = found.text
        row.segments = None
        row.language_code = normalize_language(found.language_code) or found.language_code
        row.language_probability = None
        row.model = None
        row.input_hash = transcript_input_hash(
            question.path, attachment.uid if attachment else filename
        )
        row.attachment_uid = attachment.uid if attachment else None
        row.attachment_url = attachment.url if attachment else None
        row.attachment_filename = attachment.filename if attachment else filename
        row.finished_at = datetime.utcnow()
        # Not work of any run: a job still queued for it finds it done.
        row.run_id = None
        row.job_id = None
        row.kobo_run_id = None
        row.kobo_status = "edited_in_kobo" if corrected else "sent"
        row.kobo_language = found.language_code
        row.kobo_last_error = None
        self.stats["transcripts_from_kobo"] += 1
        return True

    def consider(self, submission: SubmissionCurrent) -> list[AudioTranscript]:
        """
        Create or refresh this submission's transcript rows: Kobo's
        transcripts first, then the recordings left to transcribe. Returns
        the rows to queue. Does not commit.
        """
        if not self.audio:
            return []
        data = submission.submission_data or {}
        existing = {
            row.question_path: row
            for row in self.db.query(AudioTranscript).filter(
                AudioTranscript.survey_id == self.survey.survey_id,
                AudioTranscript.submission_id == submission._id,
            )
        }
        changed = [
            self._take_from_kobo(existing, submission, question, kobo_transcript(data, question))
            for question in self.audio
        ]
        if any(changed):
            self.db.flush()
            self._refresh_checks(submission)

        touched: list[AudioTranscript] = []
        now = datetime.utcnow()
        for question in self.questions:
            filename = answer_filename(data, question)
            if filename is None:
                continue  # not answered
            row = existing.get(question.path)
            if row is not None and row.source == SOURCE_KOBO:
                continue  # Kobo has its transcript: never transcribed here
            attachment = find_attachment(data, question, filename)
            input_hash = transcript_input_hash(
                question.path, attachment.uid if attachment else filename
            )
            if row is None:
                row = AudioTranscript(
                    survey_id=self.survey.survey_id,
                    submission_id=submission._id,
                    question_path=question.path,
                    kobo_status="not_sent",
                )
                self.db.add(row)
            elif not self._needs(row, input_hash):
                continue

            row.source = SOURCE_ELEVENLABS
            row.input_hash = input_hash
            row.attachment_uid = attachment.uid if attachment else None
            row.attachment_url = attachment.url if attachment else None
            row.attachment_filename = attachment.filename if attachment else filename
            row.model = self.model
            reset_for_transcription(row, self.run_id, self.user_id)
            touched.append(row)

            if attachment is None or attachment.deleted or not attachment.url:
                row.status = "skipped"
                row.skip_reason = "missing_file"
                row.finished_at = now
                self.stats["transcripts_skipped"] += 1
            elif not self.available:
                row.status = "failed"
                row.last_error = f"{NOT_CONFIGURED}: Transcription is not set up on this server."
                row.finished_at = now
                self.stats["transcripts_failed"] += 1
            elif self.paused_error:
                row.status = "failed"
                row.last_error = self.paused_error
                row.finished_at = now
                self.stats["transcripts_paused"] += 1
            else:
                self.stats["transcripts_queued"] += 1
        return touched

    def _refresh_checks(self, submission: SubmissionCurrent) -> None:
        """The built-in transcript checks, on the transcripts just taken from Kobo."""
        from services.transcription_runtime import refresh_transcript_issues

        refresh_transcript_issues(self.db, self.survey, submission)

    def queue(self, rows: list[AudioTranscript]) -> None:
        """Note jobs to send for rows left pending. Call after a flush, before commit."""
        for row in rows:
            if row.status != "pending":
                continue
            task_id = task_id_for(row.transcript_id, row.input_hash or "", self.run_id)
            row.job_id = task_id
            self._to_send.append(
                (
                    row.transcript_id,
                    task_id,
                    {
                        "transcript_id": row.transcript_id,
                        "input_hash": row.input_hash,
                        "run_id": str(self.run_id) if self.run_id else None,
                    },
                )
            )

    def dispatch(self, task=None) -> int:
        """Send the jobs noted since the last call. Call after committing."""
        if not self._to_send:
            return 0
        if task is None:
            from services.transcription_worker import transcribe_recording_task as task

        sent = 0
        to_send, self._to_send = self._to_send, []
        for transcript_id, task_id, payload in to_send:
            try:
                task.apply_async(kwargs={"payload": payload}, task_id=task_id)
                sent += 1
            except Exception as error:
                logger.error(
                    "Failed to enqueue transcription %s: %s", transcript_id, error, exc_info=True
                )
                row = (
                    self.db.query(AudioTranscript)
                    .filter(AudioTranscript.transcript_id == transcript_id)
                    .first()
                )
                if row is not None and row.job_id == task_id:
                    row.status = "failed"
                    row.last_error = f"unavailable: Could not queue the transcription ({error})"[
                        :1000
                    ]
                    row.finished_at = datetime.utcnow()
                    self.db.commit()
                self.stats["transcripts_queued"] -= 1
                self.stats["transcripts_failed"] += 1
        return sent


def queue_kobo_send(db: Session, row: AudioTranscript, run_id: UUID | None) -> str:
    """Mark a transcript to be sent to Kobo; returns the job id. Does not commit."""
    row.kobo_status = "pending"
    row.kobo_run_id = run_id
    row.kobo_last_error = None
    key = f"kobo:{row.transcript_id}:{row.input_hash}:{run_id}:{datetime.utcnow().isoformat()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def dispatch_kobo_send(
    db: Session, row: AudioTranscript, task_id: str, run_id: UUID | None
) -> bool:
    """Send a Kobo job for a committed pending row; on failure mark it failed."""
    from services.kobo_sync_worker import send_transcript_to_kobo_task

    try:
        send_transcript_to_kobo_task.apply_async(
            kwargs={
                "payload": {
                    "transcript_id": row.transcript_id,
                    "run_id": str(run_id) if run_id else None,
                }
            },
            task_id=task_id,
        )
        return True
    except Exception as error:
        logger.error("Failed to enqueue Kobo send for %s: %s", row.transcript_id, error)
        row.kobo_status = "failed"
        row.kobo_last_error = f"unavailable: Could not queue sending to Kobo ({error})"[:1000]
        db.commit()
        return False

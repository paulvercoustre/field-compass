"""
Deciding which transcripts to translate, and sending jobs.

A transcript is translated once into the survey's translation language: a
later pull with the same text does nothing. It is translated again when its
text changes (transcribed again, corrected in Kobo) or the survey picks
another language, and tried again when it failed for a reason that can pass,
was held back by the allowance, or was stopped.

On the operator's key, a translated submission counts against the survey's
included AI reviews, like a reviewed one, and once per submission.

See docs/specs/transcript-translation.md.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AudioTranscript, SurveyConfig, TranscriptTranslation
from etl.audio import SOURCE_KOBO, transcription_settings, translation_input_hash
from services.ai_allowance import (
    checks_remaining,
    counted_submission_ids,
    not_run_message,
    submissions_in_flight,
)
from services.ai_errors import NOT_CONFIGURED
from services.ai_providers import paused_error, survey_connection
from services.transcription_languages import normalize_language

logger = logging.getLogger(__name__)

NOT_RUN_ALLOWANCE = "not_run_allowance"
OPEN_STATUSES = ("pending", "running")
# Failures not worth retrying on every pull: the AI refused this text.
_FINAL_CATEGORIES = ("bad_request",)


def task_id_for(translation_id: int, input_hash: str, run_id: UUID | None) -> str:
    key = f"translate:{translation_id}:{input_hash}:{run_id}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def in_kobo(transcript: AudioTranscript) -> bool:
    """
    Whether Kobo shows this very transcript text: Kobo's own, or ours as sent.
    A translation is sent only then -- Kobo files it against the transcript,
    and refuses it when there is none.
    """
    return transcript.source == SOURCE_KOBO or transcript.kobo_status == "sent"


class TranslationQueuer:
    def __init__(
        self,
        db: Session,
        survey_config: SurveyConfig,
        *,
        run_id: UUID | None,
        user_id: UUID | None,
    ):
        from services.ai_service import AIService

        self.db = db
        self.survey = survey_config
        self.run_id = run_id
        self.user_id = user_id
        self.settings = transcription_settings(survey_config.config_data)
        self.language = self.settings.translate_to if self.settings.translating else None
        connection = survey_connection(db, survey_config) if self.language else None
        service = AIService() if self.language and connection is None else None
        self.available = connection is not None or (service is not None and service.is_available())
        self.model = (
            connection.check_model if connection else (service and service.translation_model)
        )
        self.paused_error = paused_error(db, survey_config) if self.language else None
        # On the operator's key, how many more submissions may be translated;
        # None when the survey has its own provider (no Field Compass limit).
        self.allowance_left: int | None = None
        self.already_counted: set[int] = set()
        if self.language and connection is None:
            self.allowance_left = checks_remaining(db, survey_config.survey_id)
            # Counted, or holding a slot already: translating it is free.
            self.already_counted = counted_submission_ids(
                db, survey_config.survey_id
            ) | submissions_in_flight(db, survey_config.survey_id)
        self.stats: Counter = Counter()
        self._to_send: list[tuple[int, str, dict[str, Any]]] = []

    @property
    def active(self) -> bool:
        return self.language is not None

    def _needs(self, row: TranscriptTranslation, input_hash: str) -> bool:
        if row.input_hash != input_hash or row.language != self.language:
            return True
        if row.status == "cancelled":
            return True
        if row.status == NOT_RUN_ALLOWANCE:
            return self.allowance_left is None or self.allowance_left > 0
        if row.status == "failed":
            category = (row.last_error or "").split(":", 1)[0]
            return category not in _FINAL_CATEGORIES
        return False

    def consider(
        self, transcript: AudioTranscript, *, force: bool = False
    ) -> TranscriptTranslation | None:
        """
        Create or refresh the translation of a finished transcript. Returns
        the row when it changed (to queue when pending). ``force`` translates
        again even when nothing changed. Does not commit.
        """
        if not self.active or transcript.status != "success":
            return None
        if transcript.question_path not in self.settings.questions:
            return None
        text = (transcript.text or "").strip()
        language = self.language
        input_hash = translation_input_hash(text, language)

        row = (
            self.db.query(TranscriptTranslation)
            .filter(TranscriptTranslation.transcript_id == transcript.transcript_id)
            .first()
        )
        if row is None:
            row = TranscriptTranslation(
                transcript_id=transcript.transcript_id,
                survey_id=transcript.survey_id,
                submission_id=transcript.submission_id,
                question_path=transcript.question_path,
                language=language,
                kobo_status="not_sent",
            )
            self.db.add(row)
        elif row.status in OPEN_STATUSES and row.input_hash == input_hash:
            return None  # already on its way
        elif not force and not self._needs(row, input_hash):
            return None

        if row.language != language:
            # Kobo files each language apart: what was sent before is not
            # this translation's earlier version.
            row.kobo_version_uuid = None
            row.kobo_language = None
            row.kobo_status = "not_sent"
        row.language = language
        row.input_hash = input_hash
        row.text = None
        row.model = self.model
        row.status = "pending"
        row.skip_reason = None
        row.last_error = None
        row.run_id = self.run_id
        row.requested_by_user_id = self.user_id
        row.job_id = None
        row.queued_at = datetime.utcnow()
        row.started_at = None
        row.finished_at = None
        if row.kobo_status != "edited_in_kobo":
            row.kobo_status = "not_sent"
        row.kobo_last_error = None
        now = datetime.utcnow()

        if not text:
            row.status, row.skip_reason, row.finished_at = "skipped", "no_speech", now
            self.stats["translations_skipped"] += 1
        elif normalize_language(transcript.language_code) == language:
            row.status, row.skip_reason, row.finished_at = "skipped", "same_language", now
            self.stats["translations_skipped"] += 1
        elif not self.available:
            row.status = "failed"
            row.last_error = f"{NOT_CONFIGURED}: Translation needs an AI provider."
            row.finished_at = now
            self.stats["translations_failed"] += 1
        elif self.paused_error:
            row.status = "failed"
            row.last_error = self.paused_error
            row.finished_at = now
            self.stats["translations_paused"] += 1
        elif (
            self.allowance_left is not None
            and self.allowance_left <= 0
            and transcript.submission_id not in self.already_counted
        ):
            row.status = NOT_RUN_ALLOWANCE
            row.last_error = not_run_message()
            row.finished_at = now
            self.stats["translations_not_run_allowance"] += 1
        else:
            if (
                self.allowance_left is not None
                and transcript.submission_id not in self.already_counted
            ):
                self.allowance_left -= 1
                self.already_counted.add(transcript.submission_id)
            self.stats["translations_queued"] += 1
        return row

    def consider_submission(
        self, survey_id: UUID, submission_id: int
    ) -> list[TranscriptTranslation]:
        """Every finished transcript of a submission. Does not commit."""
        if not self.active:
            return []
        transcripts = self.db.query(AudioTranscript).filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.submission_id == submission_id,
            AudioTranscript.status == "success",
        )
        return [row for t in transcripts if (row := self.consider(t)) is not None]

    def queue(self, rows: list[TranscriptTranslation]) -> None:
        """Note jobs to send for rows left pending. Call after a flush, before commit."""
        for row in rows:
            if row.status != "pending":
                continue
            task_id = task_id_for(row.translation_id, row.input_hash or "", self.run_id)
            row.job_id = task_id
            self._to_send.append(
                (
                    row.translation_id,
                    task_id,
                    {
                        "translation_id": row.translation_id,
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
            from services.translation_worker import translate_transcript_task as task

        sent = 0
        to_send, self._to_send = self._to_send, []
        for translation_id, task_id, payload in to_send:
            try:
                task.apply_async(kwargs={"payload": payload}, task_id=task_id)
                sent += 1
            except Exception as error:
                logger.error(
                    "Failed to enqueue translation %s: %s", translation_id, error, exc_info=True
                )
                row = self.db.get(TranscriptTranslation, translation_id)
                if row is not None and row.job_id == task_id:
                    row.status = "failed"
                    row.last_error = f"unavailable: Could not queue the translation ({error})"[
                        :1000
                    ]
                    row.finished_at = datetime.utcnow()
                    self.db.commit()
                self.stats["translations_queued"] -= 1
                self.stats["translations_failed"] += 1
        return sent


def queue_translation_send(
    db: Session, translation: TranscriptTranslation, run_id: UUID | None
) -> str:
    """Mark a translation to be sent to Kobo; returns the job id. Does not commit."""
    translation.kobo_status = "pending"
    translation.kobo_run_id = run_id
    translation.kobo_last_error = None
    key = (
        f"kobo-translation:{translation.translation_id}:{translation.input_hash}:{run_id}:"
        f"{datetime.utcnow().isoformat()}"
    )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def dispatch_translation_send(
    db: Session, translation: TranscriptTranslation, task_id: str, run_id: UUID | None
) -> bool:
    """Send a Kobo job for a committed pending translation; on failure mark it failed."""
    from services.kobo_sync_worker import send_translation_to_kobo_task

    try:
        send_translation_to_kobo_task.apply_async(
            kwargs={
                "payload": {
                    "translation_id": translation.translation_id,
                    "run_id": str(run_id) if run_id else None,
                }
            },
            task_id=task_id,
        )
        return True
    except Exception as error:
        logger.error(
            "Failed to enqueue Kobo send for translation %s: %s", translation.translation_id, error
        )
        translation.kobo_status = "failed"
        translation.kobo_last_error = f"unavailable: Could not queue sending to Kobo ({error})"[
            :1000
        ]
        db.commit()
        return False


def send_translation_when_ready(
    db: Session, transcript: AudioTranscript, run_id: UUID | None
) -> bool:
    """
    Queue the transcript's translation for Kobo when both are ready: the
    survey sends to Kobo, the translation is of the text Kobo shows, and it
    is not there yet. Commits and dispatches; returns whether it queued.
    """
    survey = db.get(SurveyConfig, transcript.survey_id)
    settings = transcription_settings(survey.config_data if survey else None)
    if not settings.sending_to_kobo or not in_kobo(transcript):
        return False
    translation = (
        db.query(TranscriptTranslation)
        .filter(TranscriptTranslation.transcript_id == transcript.transcript_id)
        .with_for_update()
        .first()
    )
    if (
        translation is None
        or translation.status != "success"
        or not (translation.text or "").strip()
        or translation.kobo_status not in ("not_sent", "failed")
        or translation.input_hash != translation_input_hash(transcript.text, translation.language)
    ):
        db.commit()
        return False
    if translation.requested_by_user_id is None:
        translation.requested_by_user_id = transcript.requested_by_user_id
    task_id = queue_translation_send(db, translation, run_id)
    db.commit()
    return dispatch_translation_send(db, translation, task_id, run_id)

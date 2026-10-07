"""
Deciding which answers to translate, and sending jobs.

A survey translates the answers to the questions its owner picks into one
language: typed answers to text questions, and the transcripts of audio
questions. An answer is translated once: a later pull with the same text does
nothing. It is translated again when its text changes (an edited answer, a
transcript made again or corrected in Kobo) or the survey picks another
language, and tried again when it failed for a reason that can pass, was held
back by the allowance, or was stopped.

A transcript Kobo already shows a translation of, in the survey's language,
is never translated here: the pull stores Kobo's translation instead (origin
"kobo"), typed there, made by Kobo, or ours corrected there.

On the operator's key, each translated answer counts against the survey's
included translations, apart from AI review's. See docs/specs/translation.md.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import (
    ITEM_OPEN,
    AnswerTranslation,
    AudioTranscript,
    SubmissionCurrent,
    SurveyConfig,
)
from etl.audio import SOURCE_KOBO, transcription_settings
from etl.translation import (
    ORIGIN_AI,
    ORIGIN_KOBO,
    SOURCE_TEXT,
    SOURCE_TRANSCRIPT,
    TranslatableQuestion,
    has_words,
    kobo_translation,
    selected_questions,
    text_answer,
    translation_input_hash,
    translation_settings,
)
from services.ai_allowance import Account, translation_not_run_message, translations_remaining
from services.ai_errors import NOT_CONFIGURED
from services.ai_providers import translation_connection, translation_paused_error
from services.transcription_languages import normalize_language

logger = logging.getLogger(__name__)

NOT_RUN_ALLOWANCE = "not_run_allowance"
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
        self.settings = translation_settings(survey_config.config_data)
        self.language = self.settings.language if self.settings.active else None
        self.questions: dict[str, TranslatableQuestion] = {
            q.path: q for q in selected_questions(survey_config.config_data, self.settings)
        }
        connection = translation_connection(db, survey_config) if self.language else None
        service = AIService() if self.language and connection is None else None
        self.available = connection is not None or (service is not None and service.is_available())
        self.model = (
            connection.check_model if connection else (service and service.translation_model)
        )
        self.paused_error = translation_paused_error(db, survey_config) if self.language else None
        # On the operator's key, how many more answers may be translated this
        # month; None when the survey has its own key (no Field Compass limit).
        self.allowance_left: int | None = (
            translations_remaining(db, Account.of(survey_config))
            if self.language and connection is None
            else None
        )
        self.stats: Counter = Counter()
        self._to_send: list[tuple[int, str, dict[str, Any]]] = []

    @property
    def active(self) -> bool:
        return self.language is not None and bool(self.questions)

    # --- Rows -----------------------------------------------------------------

    def _target_language(self) -> str:
        """The language translated into. Only asked for while translation is on."""
        if self.language is None:
            raise RuntimeError("Translation is off for this survey: nothing to translate into.")
        return self.language

    def _row(self, submission_id: int, question_path: str) -> AnswerTranslation | None:
        return (
            self.db.query(AnswerTranslation)
            .filter(
                AnswerTranslation.survey_id == self.survey.survey_id,
                AnswerTranslation.submission_id == submission_id,
                AnswerTranslation.question_path == question_path,
            )
            .first()
        )

    def _needs(self, row: AnswerTranslation, input_hash: str) -> bool:
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

    def _take_from_kobo(
        self,
        row: AnswerTranslation | None,
        submission: SubmissionCurrent,
        question: TranslatableQuestion,
        transcript: AudioTranscript,
    ) -> tuple[AnswerTranslation | None, bool]:
        """
        Keep the stored translation in step with Kobo's: store Kobo's when it
        has one in the survey's language that is not ours, and forget Kobo's
        once it is gone there. Returns the row and whether Kobo has one (then
        nothing is translated here). Does not commit.
        """
        language = self._target_language()
        found = kobo_translation(
            submission.submission_data or {}, question.path, question.name, language
        )
        if found is None:
            if row is not None and row.origin == ORIGIN_KOBO:
                # Removed in Kobo: translated here again.
                self.db.delete(row)
                self.db.flush()
                return None, False
            return row, False
        if row is not None and row.origin == ORIGIN_KOBO and row.language == language:
            if row.text == found.text:
                return row, True
        elif row is not None and row.language == language:
            if row.status == "running" or (row.text or "").strip() == found.text:
                return row, True  # ours as sent to Kobo, or settled on the next pull
            if row.kobo_version_uuid and row.kobo_status not in ("sent", "edited_in_kobo"):
                # A newer one of ours is on its way to Kobo (or not sent);
                # sending checks first that nobody corrected ours there.
                return row, True
        if row is None:
            row = self._new_row(submission._id, question)
        # Kobo's stands: typed there, Kobo's own, or ours corrected there.
        corrected = (
            row.origin == ORIGIN_AI
            and row.language == language
            and row.kobo_version_uuid is not None
        )
        row.origin = ORIGIN_KOBO
        row.source = SOURCE_TRANSCRIPT
        row.transcript_id = transcript.transcript_id
        row.language = language
        row.input_hash = translation_input_hash(transcript.text, language)
        row.status = "success"
        row.skip_reason = None
        row.last_error = None
        row.text = found.text
        row.model = None
        row.finished_at = datetime.utcnow()
        # Not work of any run: a job still queued for it finds it done.
        row.run_id = None
        row.job_id = None
        row.kobo_run_id = None
        row.kobo_status = "edited_in_kobo" if corrected else "sent"
        row.kobo_language = found.language_code
        row.kobo_last_error = None
        self.stats["translations_from_kobo"] += 1
        return row, True

    def _new_row(self, submission_id: int, question: TranslatableQuestion) -> AnswerTranslation:
        row = AnswerTranslation(
            survey_id=self.survey.survey_id,
            submission_id=submission_id,
            question_path=question.path,
            source=SOURCE_TRANSCRIPT if question.kind == "audio" else SOURCE_TEXT,
            language=self.language,
            origin=ORIGIN_AI,
            kobo_status="not_sent",
        )
        self.db.add(row)
        return row

    # --- Deciding ---------------------------------------------------------------

    def _consider(
        self,
        row: AnswerTranslation | None,
        submission_id: int,
        question: TranslatableQuestion,
        text: str,
        *,
        transcript: AudioTranscript | None = None,
        force: bool = False,
    ) -> AnswerTranslation | None:
        language = self._target_language()
        input_hash = translation_input_hash(text, language)
        if row is not None and row.origin == ORIGIN_KOBO and row.language == language:
            return None  # Kobo's translation stands
        if row is None:
            row = self._new_row(submission_id, question)
        elif row.status in ITEM_OPEN and row.input_hash == input_hash:
            return None  # already on its way
        elif not force and not self._needs(row, input_hash):
            return None

        if row.language != language:
            # Kobo files each language apart: what was sent before is not
            # this translation's earlier version.
            row.kobo_version_uuid = None
            row.kobo_language = None
            row.kobo_status = "not_sent"
        row.origin = ORIGIN_AI
        row.source = SOURCE_TRANSCRIPT if transcript is not None else SOURCE_TEXT
        row.transcript_id = transcript.transcript_id if transcript is not None else None
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

        if not has_words(text):
            row.status, row.skip_reason, row.finished_at = "skipped", "no_text", now
            self.stats["translations_skipped"] += 1
        elif (
            transcript is not None
            and normalize_language(transcript.language_code) == language
            and (transcript.language_probability is None or transcript.language_probability >= 0.8)
        ):
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
        elif self.allowance_left is not None and self.allowance_left <= 0:
            row.status = NOT_RUN_ALLOWANCE
            row.last_error = translation_not_run_message()
            row.finished_at = now
            self.stats["translations_not_run_allowance"] += 1
        else:
            if self.allowance_left is not None:
                self.allowance_left -= 1
            self.stats["translations_queued"] += 1
        return row

    def consider_transcript(
        self,
        transcript: AudioTranscript,
        submission: SubmissionCurrent | None = None,
        *,
        force: bool = False,
    ) -> AnswerTranslation | None:
        """
        A finished transcript: Kobo's translation of it when Kobo has one,
        else translated here. Returns the row when it is to be queued (or
        held back). Does not commit.
        """
        if not self.active or transcript.status != "success":
            return None
        question = self.questions.get(transcript.question_path)
        if question is None:
            return None
        if submission is None:
            submission = (
                self.db.query(SubmissionCurrent)
                .filter(
                    SubmissionCurrent._id == transcript.submission_id,
                    SubmissionCurrent.survey_id == transcript.survey_id,
                )
                .first()
            )
        row = self._row(transcript.submission_id, question.path)
        if submission is not None:
            row, from_kobo = self._take_from_kobo(row, submission, question, transcript)
            if from_kobo:
                return None
        return self._consider(
            row,
            transcript.submission_id,
            question,
            (transcript.text or "").strip(),
            transcript=transcript,
            force=force,
        )

    def consider_submission(
        self, submission: SubmissionCurrent, *, force: bool = False
    ) -> list[AnswerTranslation]:
        """
        Every chosen question of a submission: its typed answer, or its
        finished transcript. Returns the rows to queue. Does not commit.
        """
        if not self.active:
            return []
        data = submission.submission_data or {}
        transcripts = {
            row.question_path: row
            for row in self.db.query(AudioTranscript).filter(
                AudioTranscript.survey_id == self.survey.survey_id,
                AudioTranscript.submission_id == submission._id,
                AudioTranscript.status == "success",
            )
        }
        touched: list[AnswerTranslation] = []
        for question in self.questions.values():
            if question.kind == "audio":
                transcript = transcripts.get(question.path)
                if transcript is not None:
                    row = self.consider_transcript(transcript, submission, force=force)
                    if row is not None:
                        touched.append(row)
                continue
            text = text_answer(data, question)
            row = self._row(submission._id, question.path)
            if text is None:
                if row is not None and row.status not in ITEM_OPEN:
                    self.db.delete(row)  # the answer was removed
                continue
            row = self._consider(row, submission._id, question, text, force=force)
            if row is not None:
                touched.append(row)
        return touched

    # --- Sending ----------------------------------------------------------------

    def queue(self, rows: list[AnswerTranslation]) -> None:
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
            from services.translation_worker import translate_answer_task as task

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
                row = self.db.get(AnswerTranslation, translation_id)
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


def sending_to_kobo(survey: SurveyConfig | None) -> bool:
    """Translations of transcripts go to Kobo: turned on, and sending to Kobo not paused."""
    if survey is None or not survey.kobo_asset_id:
        return False
    if not translation_settings(survey.config_data).sending_to_kobo:
        return False
    return not transcription_settings(survey.config_data).kobo_pause


def queue_translation_send(db: Session, translation: AnswerTranslation, run_id: UUID | None) -> str:
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
    db: Session, translation: AnswerTranslation, task_id: str, run_id: UUID | None
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
    except Exception as error:  # noqa: BLE001 -- broker down, or anything else: record it
        logger.error(
            "Failed to enqueue Kobo send for translation %s: %s", translation.translation_id, error
        )
        translation.kobo_status = "failed"
        translation.kobo_last_error = f"unavailable: Could not queue sending to Kobo ({error})"[
            :1000
        ]
        db.commit()
        return False


def sendable(
    translation: AnswerTranslation,
    transcript: AudioTranscript | None,
    kobo_statuses: tuple[str, ...] = ("not_sent", "failed"),
) -> bool:
    """A translation of ours, made from the transcript text Kobo shows, not in Kobo yet."""
    return (
        transcript is not None
        and translation.origin == ORIGIN_AI
        and translation.source == SOURCE_TRANSCRIPT
        and translation.status == "success"
        and bool((translation.text or "").strip())
        and translation.kobo_status in kobo_statuses
        and in_kobo(transcript)
        and translation.input_hash == translation_input_hash(transcript.text, translation.language)
    )


def send_translation_when_ready(
    db: Session, transcript: AudioTranscript, run_id: UUID | None
) -> bool:
    """
    Queue the transcript's translation for Kobo when both are ready: the
    survey sends translations to Kobo, the translation is of the text Kobo
    shows, and it is not there yet. Commits and dispatches; returns whether
    it queued.
    """
    survey = db.get(SurveyConfig, transcript.survey_id)
    if not sending_to_kobo(survey):
        return False
    translation = (
        db.query(AnswerTranslation)
        .filter(
            AnswerTranslation.survey_id == transcript.survey_id,
            AnswerTranslation.submission_id == transcript.submission_id,
            AnswerTranslation.question_path == transcript.question_path,
        )
        .with_for_update()
        .first()
    )
    if translation is None or not sendable(translation, transcript):
        db.commit()
        return False
    if translation.requested_by_user_id is None:
        translation.requested_by_user_id = transcript.requested_by_user_id
    task_id = queue_translation_send(db, translation, run_id)
    db.commit()
    return dispatch_translation_send(db, translation, task_id, run_id)

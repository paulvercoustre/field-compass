"""
Translating one answer: send its text (a typed answer, or a transcript) to the
survey's AI provider for translation, store the translation, and send a
translated transcript to Kobo when the survey does.

See docs/specs/translation.md.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime
from typing import Any

if "/app" not in sys.path and os.path.isdir("/app"):
    sys.path.insert(0, "/app")

from database.models import AnswerTranslation, AudioTranscript, SubmissionCurrent, SurveyConfig
from etl.translation import (
    ORIGIN_AI,
    SOURCE_TRANSCRIPT,
    selected_questions,
    text_answer,
    translation_input_hash,
    translation_settings,
)
from services.ai_errors import NOT_CONFIGURED, AIError
from services.ai_providers import resolve_translation_provider
from services.ai_service import AIService
from services.ai_usage import TRANSLATION, usage_recorder
from services.database import SessionLocal
from services.runs import fail_stalled_items, fail_stalled_kobo_sends, finish_if_done
from services.transcription_languages import language_name
from services.translation_queue import send_translation_when_ready

logger = logging.getLogger(__name__)


def _finish(
    db, row: AnswerTranslation, status: str, error: str | None = None, skip: str | None = None
) -> None:
    row.status = status
    row.last_error = error[:1000] if error else None
    row.skip_reason = skip
    row.finished_at = datetime.utcnow()
    db.commit()


def _current_text(
    db, row: AnswerTranslation, survey: SurveyConfig
) -> tuple[str | None, AudioTranscript | None]:
    """The text the answer has now: its finished transcript, or its typed answer."""
    if row.source == SOURCE_TRANSCRIPT:
        transcript = db.get(AudioTranscript, row.transcript_id) if row.transcript_id else None
        if transcript is None or transcript.status != "success":
            return None, transcript
        return (transcript.text or "").strip(), transcript
    submission = (
        db.query(SubmissionCurrent)
        .filter(
            SubmissionCurrent._id == row.submission_id,
            SubmissionCurrent.survey_id == row.survey_id,
        )
        .first()
    )
    question = next(
        (q for q in selected_questions(survey.config_data) if q.path == row.question_path), None
    )
    if submission is None or question is None:
        return None, None
    return text_answer(submission.submission_data or {}, question), None


def run_translation_job(
    payload: dict[str, Any], job_id: str, final_attempt: bool = True
) -> dict[str, Any]:
    """
    Translate one answer. A retryable failure with attempts left leaves the
    translation pending and raises the AIError for the task to retry.
    """
    db = SessionLocal()
    row: AnswerTranslation | None = None
    try:
        translation_id = int(payload["translation_id"])
        row = (
            db.query(AnswerTranslation)
            .filter(AnswerTranslation.translation_id == translation_id)
            .with_for_update()
            .first()
        )
        if row is None:
            db.commit()
            return {"status": "missing"}
        if (
            row.input_hash != payload.get("input_hash")
            or row.status not in ("pending", "running")
            or row.origin != ORIGIN_AI
        ):
            db.commit()
            return {"status": "stale", "translation_id": translation_id}
        run_id = row.run_id

        survey = db.get(SurveyConfig, row.survey_id)
        settings = translation_settings(survey.config_data if survey else None)
        if (
            survey is None
            or not settings.active
            or settings.language != row.language
            or row.question_path not in settings.questions
        ):
            _finish(db, row, "cancelled", "cancelled: Translation was turned off or changed.")
            finish_if_done(db, run_id)
            return {"status": "cancelled"}
        text, transcript = _current_text(db, row, survey)
        if text is None or row.input_hash != translation_input_hash(text, row.language):
            # The answer changed since: the next pull translates the new one.
            _finish(db, row, "cancelled", "cancelled: The answer changed before translation.")
            finish_if_done(db, run_id)
            return {"status": "cancelled"}

        service = AIService()
        try:
            provider = resolve_translation_provider(db, survey)
        except AIError as error:  # the survey's own key is paused or unusable
            _finish(db, row, "failed", str(error))
            finish_if_done(db, run_id)
            return {"status": "failed", "category": error.category}
        if provider is None and not service.is_available():
            _finish(db, row, "failed", f"{NOT_CONFIGURED}: Translation needs an AI provider.")
            finish_if_done(db, run_id)
            return {"status": "failed", "category": NOT_CONFIGURED}

        row.status = "running"
        row.job_id = job_id
        row.started_at = datetime.utcnow()
        row.last_error = None
        row.model = provider.model if provider else service.translation_model
        db.commit()

        labels = {q.path: q.label for q in selected_questions(survey.config_data, settings)}
        try:
            translated = service.translate_answer(
                text,
                target_language=language_name(row.language) or row.language,
                source_language=language_name(transcript.language_code) if transcript else None,
                question=labels.get(row.question_path),
                transcript=transcript is not None,
                record=usage_recorder(
                    db,
                    survey.survey_id,
                    TRANSLATION,
                    row.submission_id,
                    provider=provider,
                    billed_user_id=survey.user_id,
                ),
                provider=provider,
                end_user=str(survey.user_id) if survey.user_id else None,
            )
        except AIError as error:
            if error.retryable and not final_attempt:
                row.status = "pending"
                row.last_error = f"{error} (retrying)"[:1000]
                db.commit()
                raise
            _finish(db, row, "failed", str(error))
            finish_if_done(db, run_id)
            return {"status": "failed", "category": error.category}

        if translated is None:
            _finish(db, row, "skipped", skip="same_language")
            finish_if_done(db, run_id)
            return {"status": "skipped", "translation_id": translation_id}
        row.text = translated
        _finish(db, row, "success")
        if transcript is not None:
            try:
                send_translation_when_ready(db, transcript, run_id)
            except Exception:
                db.rollback()
                logger.exception("Could not queue translation %s for Kobo", row.translation_id)
        finish_if_done(db, run_id)
        return {"status": "success", "translation_id": translation_id}
    except AIError:
        raise  # retryable, stored as pending above
    except Exception as exc:
        logger.error("Translation job failed: %s", exc, exc_info=True)
        db.rollback()
        if row is not None:
            try:
                failed = db.get(AnswerTranslation, row.translation_id)
                if failed is not None and failed.status in ("pending", "running"):
                    _finish(db, failed, "failed", f"internal: {exc}")
                    finish_if_done(db, failed.run_id)
            except Exception:  # noqa: BLE001 -- recording the failure must not mask it
                db.rollback()
        raise
    finally:
        db.close()


def sweep_stalled_translations(db, now: datetime | None = None) -> int:
    """Fail translations that lost their worker, and their Kobo sends."""
    now = now or datetime.utcnow()
    stalled = fail_stalled_items(db, AnswerTranslation, now, "translation")
    kobo_stalled = fail_stalled_kobo_sends(db, AnswerTranslation, now)
    db.commit()
    return len(stalled) + kobo_stalled

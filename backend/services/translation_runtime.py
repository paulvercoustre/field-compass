"""
Translating one transcript: send its text to the survey's AI provider, store
the translation, and send it to Kobo when the survey does.

See docs/specs/transcript-translation.md.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any

if "/app" not in sys.path and os.path.isdir("/app"):
    sys.path.insert(0, "/app")

from database.models import AudioTranscript, SurveyConfig, TranscriptTranslation
from etl.audio import audio_questions, transcription_settings, translation_input_hash
from services.ai_errors import NOT_CONFIGURED, AIError
from services.ai_providers import CHECKS, resolve_provider
from services.ai_service import AIService
from services.ai_usage import TRANSLATION, usage_recorder
from services.database import SessionLocal
from services.runs import finish_if_done
from services.transcription_languages import language_name
from services.translation_queue import send_translation_when_ready

logger = logging.getLogger(__name__)

STALLED_RUNNING_AFTER = timedelta(minutes=30)
STALLED_PENDING_AFTER = timedelta(hours=6)


def _finish(db, row: TranscriptTranslation, status: str, error: str | None = None) -> None:
    row.status = status
    row.last_error = error[:1000] if error else None
    row.finished_at = datetime.utcnow()
    db.commit()


def run_translation_job(
    payload: dict[str, Any], job_id: str, final_attempt: bool = True
) -> dict[str, Any]:
    """
    Translate one transcript. A retryable failure with attempts left leaves
    the translation pending and raises the AIError for the task to retry.
    """
    db = SessionLocal()
    row: TranscriptTranslation | None = None
    try:
        translation_id = int(payload["translation_id"])
        row = (
            db.query(TranscriptTranslation)
            .filter(TranscriptTranslation.translation_id == translation_id)
            .with_for_update()
            .first()
        )
        if row is None:
            db.commit()
            return {"status": "missing"}
        if row.input_hash != payload.get("input_hash") or row.status not in ("pending", "running"):
            db.commit()
            return {"status": "stale", "translation_id": translation_id}
        run_id = row.run_id

        transcript = db.get(AudioTranscript, row.transcript_id)
        survey = db.get(SurveyConfig, row.survey_id)
        settings = transcription_settings(survey.config_data if survey else None)
        if (
            survey is None
            or transcript is None
            or not settings.translating
            or settings.translate_to != row.language
        ):
            _finish(db, row, "cancelled", "cancelled: Translation was turned off or changed.")
            finish_if_done(db, run_id)
            return {"status": "cancelled"}
        if transcript.status != "success" or row.input_hash != translation_input_hash(
            transcript.text, row.language
        ):
            # The transcript changed since: the next pull translates the new one.
            _finish(db, row, "cancelled", "cancelled: The transcript changed before translation.")
            finish_if_done(db, run_id)
            return {"status": "cancelled"}

        service = AIService()
        try:
            provider = resolve_provider(db, survey, CHECKS)
        except AIError as error:  # the survey's own provider is paused or unusable
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

        labels = {q.path: q.label for q in audio_questions(survey.config_data)}
        try:
            text = service.translate_transcript(
                transcript.text or "",
                target_language=language_name(row.language) or row.language,
                source_language=language_name(transcript.language_code),
                question=labels.get(row.question_path),
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

        row.text = text
        _finish(db, row, "success")
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
                failed = db.get(TranscriptTranslation, row.translation_id)
                if failed is not None and failed.status in ("pending", "running"):
                    _finish(db, failed, "failed", f"internal: {exc}")
                    finish_if_done(db, failed.run_id)
            except Exception:
                db.rollback()
        raise
    finally:
        db.close()


def sweep_stalled_translations(db, now: datetime | None = None) -> int:
    """Fail translations that lost their worker, and their Kobo sends."""
    now = now or datetime.utcnow()
    stalled = (
        db.query(TranscriptTranslation)
        .filter(
            (
                (TranscriptTranslation.status == "running")
                & (TranscriptTranslation.started_at < now - STALLED_RUNNING_AFTER)
            )
            | (
                (TranscriptTranslation.status == "pending")
                & (TranscriptTranslation.queued_at < now - STALLED_PENDING_AFTER)
            )
        )
        .all()
    )
    for row in stalled:
        row.status = "failed"
        row.last_error = "timeout: The translation did not finish."
        row.finished_at = now
    kobo_stalled = (
        db.query(TranscriptTranslation)
        .filter(
            TranscriptTranslation.kobo_status == "pending",
            TranscriptTranslation.updated_at < now - timedelta(hours=6),
        )
        .all()
    )
    for row in kobo_stalled:
        row.kobo_status = "failed"
        row.kobo_last_error = "timeout: Sending to Kobo did not finish."
    db.commit()
    return len(stalled) + len(kobo_stalled)

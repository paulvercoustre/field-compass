"""
Translation: a survey's settings, starting and re-sending work, and a
submission's translations.

A survey translates the answers to the questions its owner picks -- typed
answers to text questions, and transcripts of audio questions -- into one
language, with its own AI key for translation or within the included
translations. See docs/specs/translation.md.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import (
    AnswerTranslation,
    AudioTranscript,
    SubmissionCurrent,
    SurveyConfig,
    User,
)
from etl.audio import transcription_settings
from etl.translation import (
    ORIGIN_AI,
    ORIGIN_KOBO,
    SETTINGS_KEY,
    has_words,
    selected_questions,
    text_answer,
    translatable_questions,
    translation_settings,
)
from services.ai_allowance import (
    Account,
    allowance_enabled,
    month_start,
    translations_in_flight,
    translations_per_month,
    translations_used,
)
from services.ai_providers import translation_connection, translation_paused_error
from services.auth import CurrentUser
from services.database import DbSession
from services.permissions import (
    OwnedSurvey,
    ViewableSurvey,
    get_user_permission,
    require_survey_access,
)
from services.runs import (
    KOBO_RESEND,
    TRANSLATION_RERUN,
    count_by,
    finish_if_done,
    iso,
    run_summary,
    start_background_run,
    update_stats,
)
from services.transcription_languages import language_name, normalize_language, scribe_languages
from services.translation_queue import (
    TranslationQueuer,
    dispatch_translation_send,
    queue_translation_send,
    sendable,
    sending_to_kobo,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _missing(db: Session, survey: SurveyConfig) -> int:
    """Answers to the chosen questions with nothing in the survey's language yet."""
    settings = translation_settings(survey.config_data)
    questions = selected_questions(survey.config_data, settings)
    if not questions:
        return 0
    done = {
        tuple(pair)
        for pair in db.query(
            AnswerTranslation.submission_id, AnswerTranslation.question_path
        ).filter(
            AnswerTranslation.survey_id == survey.survey_id,
            AnswerTranslation.language == settings.language,
        )
    }
    audio = {q.path for q in questions if q.kind == "audio"}
    text = [q for q in questions if q.kind != "audio"]
    count = 0
    if audio:
        for submission_id, path, value in db.query(
            AudioTranscript.submission_id, AudioTranscript.question_path, AudioTranscript.text
        ).filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.status == "success",
            AudioTranscript.question_path.in_(audio),
        ):
            if has_words(value) and (submission_id, path) not in done:
                count += 1
    if text:
        for submission_id, data in db.query(
            SubmissionCurrent._id, SubmissionCurrent.submission_data
        ).filter(SubmissionCurrent.survey_id == survey.survey_id):
            for question in text:
                if (submission_id, question.path) not in done and has_words(
                    text_answer(data or {}, question)
                ):
                    count += 1
    return count


def _counts(db: Session, survey: SurveyConfig) -> dict[str, Any]:
    settings = translation_settings(survey.config_data)
    current = (AnswerTranslation.survey_id == survey.survey_id) & (
        AnswerTranslation.language == (settings.language or "")
    )
    status = count_by(db, AnswerTranslation.status, current, AnswerTranslation.origin == ORIGIN_AI)
    from_kobo = (
        db.query(func.count(AnswerTranslation.translation_id))
        .filter(current, AnswerTranslation.origin == ORIGIN_KOBO)
        .scalar()
    )
    kobo = count_by(
        db,
        AnswerTranslation.kobo_status,
        current,
        AnswerTranslation.origin == ORIGIN_AI,
        AnswerTranslation.source == "transcript",
        AnswerTranslation.status == "success",
    )
    return {
        "success": status.get("success", 0),
        "in_progress": status.get("pending", 0) + status.get("running", 0),
        "failed": status.get("failed", 0),
        "not_run": status.get("not_run_allowance", 0) + status.get("cancelled", 0),
        "skipped": status.get("skipped", 0),
        "from_kobo": from_kobo or 0,
        "missing": _missing(db, survey) if settings.active else 0,
        "kobo": {
            "sent": kobo.get("sent", 0),
            "edited_in_kobo": kobo.get("edited_in_kobo", 0),
            "failed": kobo.get("failed", 0),
            "unsupported": kobo.get("unsupported", 0),
            "pending": kobo.get("pending", 0),
            "unsent": kobo.get("not_sent", 0) + kobo.get("failed", 0),
        },
    }


def _key(db: Session, survey: SurveyConfig, user: User) -> dict[str, Any]:
    """
    Who translates: the owner's own AI key for translation, chosen in Account
    settings, or Field Compass's within the included translations.
    """
    from services.ai_service import AIService

    connection = translation_connection(db, survey)
    if connection is not None:
        paused = translation_paused_error(db, survey)
        return {
            "source": "own",
            "label": connection.label,
            "model": connection.check_model,
            "paused": paused.split(": ", 1)[-1] if paused else None,
            "viewer_is_owner": survey.user_id == user.user_id,
        }
    service = AIService()
    included = allowance_enabled()
    return {
        "source": "operator" if included else None,
        "label": None,
        "model": service.translation_model if included else None,
        "paused": None,
        "viewer_is_owner": survey.user_id == user.user_id,
    }


def _payload(db: Session, survey: SurveyConfig, user: User) -> dict[str, Any]:
    settings = translation_settings(survey.config_data)
    transcribing = transcription_settings(survey.config_data)
    transcribed = set(transcribing.questions) if transcribing.active else set()
    key = _key(db, survey, user)
    account = Account.of(survey)
    used = translations_used(db, account)
    in_flight = translations_in_flight(db, account)
    limit = translations_per_month() if allowance_enabled() else 0
    permission = get_user_permission(db, user, survey.survey_id)
    return {
        "available": key["source"] is not None,
        "key": key,
        "settings": {
            "enabled": settings.enabled,
            "language": settings.language,
            "questions": list(settings.questions),
            "send_to_kobo": settings.send_to_kobo,
        },
        "questions": [
            {
                "path": q.path,
                "name": q.name,
                "label": q.label,
                "kind": q.kind,
                "in_repeat": q.in_repeat,
                # An audio question's transcript is what is translated.
                "transcribed": q.kind != "audio" or q.path in transcribed,
            }
            for q in translatable_questions(survey.config_data)
        ],
        "languages": scribe_languages(),
        # What the included usage gives the owner's account a month, shared by
        # all their surveys, whoever pays for this one now.
        "included_per_month": limit,
        "allowance": {
            "month": month_start().strftime("%Y-%m"),
            "limit": limit,
            "used": used,
            "in_flight": in_flight,
            "remaining": max(0, limit - used - in_flight),
        }
        if key["source"] == "operator"
        else None,
        # Translations of transcripts can go to Kobo; Kobo keeps none for typed answers.
        "kobo_pause": transcribing.kobo_pause,
        "counts": _counts(db, survey),
        "can_edit": permission in ("owner", "admin"),
    }


@router.get("/surveys/{survey_id}/translation")
async def get_translation_settings(
    survey: ViewableSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    The survey's translation settings and everything the settings tab needs:
    the form's text and audio questions, the languages, who translates and
    this month's included translations, and how many answers are translated.
    """
    return _payload(db, survey, current_user)


class TranslationSettingsUpdate(BaseModel):
    enabled: bool = False
    language: str | None = None
    questions: list[str] = Field(default_factory=list)
    send_to_kobo: bool = False


@router.put("/surveys/{survey_id}/translation")
async def update_translation_settings(
    body: TranslationSettingsUpdate,
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """Save the survey's translation settings (owner)."""
    questions = {q.path: q for q in translatable_questions(survey.config_data)}

    chosen: list[str] = []
    for path in body.questions:
        question = questions.get(path)
        if question is None:
            raise HTTPException(
                status_code=400, detail=f"“{path}” is not a text or audio question in this form."
            )
        if question.in_repeat:
            raise HTTPException(
                status_code=400,
                detail=f"“{question.label}” is inside a repeat group; those can't be translated yet.",
            )
        if path not in chosen:
            chosen.append(path)

    language = None
    if body.language:
        language = normalize_language(body.language)
        if language is None:
            raise HTTPException(
                status_code=400, detail=f"Answers can't be translated into “{body.language}”."
            )
    if body.enabled and not language:
        raise HTTPException(status_code=400, detail="Choose a language to translate into.")
    if body.enabled and not chosen:
        raise HTTPException(status_code=400, detail="Choose at least one question to translate.")

    config = dict(survey.config_data or {})
    config[SETTINGS_KEY] = {
        "enabled": body.enabled,
        "language": language,
        "questions": chosen,
        "send_to_kobo": body.send_to_kobo,
    }
    survey.config_data = config
    survey.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(survey)
    return _payload(db, survey, current_user)


@router.post("/surveys/{survey_id}/translations/run", status_code=202)
async def translate_now(
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
    mode: Annotated[str, Query(pattern="^(missing|all)$")] = "missing",
):
    """
    Translate answers already pulled, without waiting for the next pull
    (owner). ``missing``: those with no translation in the survey's language
    yet, or whose last attempt can be retried. ``all``: every answer again,
    except translations Kobo has.
    """
    if not translation_settings(survey.config_data).active:
        raise HTTPException(
            status_code=400,
            detail="Turn translation on and choose a language and questions first.",
        )

    run = start_background_run(db, survey, TRANSLATION_RERUN, current_user, stats={"mode": mode})
    queuer = TranslationQueuer(db, survey, run_id=run.run_id, user_id=current_user.user_id)
    submissions = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey.survey_id)
        .order_by(SubmissionCurrent._submission_time.desc())
        .all()
    )
    for submission in submissions:
        rows = queuer.consider_submission(submission, force=mode == "all")
        if rows:
            db.flush()
            queuer.queue(rows)
    update_stats(run, **dict(queuer.stats))
    db.commit()
    queuer.dispatch()
    finish_if_done(db, run.run_id)
    db.refresh(run)
    return run_summary(db, run, survey)


@router.post("/surveys/{survey_id}/translations/send-to-kobo", status_code=202)
async def send_translations_to_kobo(
    survey: OwnedSurvey,
    db: DbSession,
    current_user: CurrentUser,
):
    """Send every translated transcript not yet in Kobo whose transcript Kobo shows (owner)."""
    if not translation_settings(survey.config_data).send_to_kobo:
        raise HTTPException(status_code=400, detail="Turn on “Send translations to Kobo” first.")
    pause = transcription_settings(survey.config_data).kobo_pause
    if pause:
        raise HTTPException(
            status_code=409,
            detail=pause.get("message")
            or "Sending to Kobo is paused. Save the transcription settings again to resume.",
        )
    if not sending_to_kobo(survey):
        raise HTTPException(status_code=400, detail="Turn translation on first.")

    pairs = (
        db.query(AnswerTranslation, AudioTranscript)
        .join(AudioTranscript, AudioTranscript.transcript_id == AnswerTranslation.transcript_id)
        .filter(
            AnswerTranslation.survey_id == survey.survey_id,
            AnswerTranslation.kobo_status.in_(("not_sent", "failed")),
        )
        .all()
    )
    rows = [translation for translation, transcript in pairs if sendable(translation, transcript)]
    run = start_background_run(
        db, survey, KOBO_RESEND, current_user, stats={"kobo_queued": len(rows)}
    )
    jobs: list[tuple[AnswerTranslation, str]] = []
    for row in rows:
        row.requested_by_user_id = current_user.user_id
        jobs.append((row, queue_translation_send(db, row, run.run_id)))
    db.commit()
    for row, task_id in jobs:
        dispatch_translation_send(db, row, task_id, run.run_id)
    finish_if_done(db, run.run_id)
    db.refresh(run)
    return run_summary(db, run, survey)


def translation_view(row: AnswerTranslation | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "source": row.source,
        # "kobo": the translation Kobo shows, typed or made there.
        "origin": row.origin,
        "status": row.status,
        "skip_reason": row.skip_reason,
        "language": row.language,
        "language_name": language_name(row.language),
        "text": row.text,
        "last_error": row.last_error,
        "finished_at": iso(row.finished_at),
        "kobo_status": row.kobo_status,
        "kobo_last_error": row.kobo_last_error,
        "kobo_sent_at": iso(row.kobo_sent_at),
    }


@router.get("/submissions/{kobo_id}/translations")
async def get_submission_translations(
    kobo_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """A submission's translations in the survey's language, by question path."""
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if submission is None:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")
    survey = require_survey_access(db, current_user, submission.survey_id, min_level="viewer")
    settings = translation_settings(survey.config_data)
    rows = (
        db.query(AnswerTranslation)
        .filter(
            AnswerTranslation.survey_id == survey.survey_id,
            AnswerTranslation.submission_id == submission._id,
            AnswerTranslation.language == (settings.language or ""),
        )
        .all()
        if settings.active
        else []
    )
    return {
        "enabled": settings.active,
        "language": settings.language if settings.active else None,
        "language_name": language_name(settings.language) if settings.active else None,
        "send_to_kobo": settings.sending_to_kobo,
        "questions": list(settings.questions) if settings.active else [],
        "answers": {row.question_path: translation_view(row) for row in rows},
    }

"""
Audio transcription: a survey's settings, starting and re-sending work, and a
submission's transcripts and recordings.

See docs/specs/audio-transcription.md, part A.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import ITEM_OPEN, AudioTranscript, SubmissionCurrent, SurveyConfig, User
from etl.audio import (
    SOURCE_KOBO,
    answer_filename,
    audio_questions,
    find_attachment,
    selected_questions,
    transcription_settings,
)
from etl.kobo_fetcher import KoboFetcher, KoboFetchError
from forms.schema import load_form_schema
from services.ai_allowance import month_start
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.permissions import get_user_permission, require_survey_access, survey_access
from services.runs import (
    KOBO_RESEND,
    TRANSCRIPTION_RERUN,
    count_by,
    finish_if_done,
    iso,
    run_summary,
    start_background_run,
)
from services.transcription_allowance import (
    max_recording_seconds,
    minutes_per_survey_month,
    seconds_on_own_key,
    seconds_used,
)
from services.transcription_keys import OWN, client_for, resolve_transcription_key
from services.transcription_languages import (
    form_languages,
    language_name,
    normalize_language,
    scribe_languages,
)
from services.transcription_queue import (
    TranscriptionQueuer,
    dispatch_kobo_send,
    queue_kobo_send,
)

logger = logging.getLogger(__name__)

router = APIRouter()

SETTINGS_KEY = "audio_transcription"


def _form_language_labels(config_data: dict[str, Any] | None) -> list[str]:
    kobo_tool = (config_data or {}).get("kobo_tool") or {}
    return load_form_schema(kobo_tool).languages if isinstance(kobo_tool, dict) else []


def _counts(db: Session, survey_id: UUID) -> dict[str, Any]:
    status = count_by(db, AudioTranscript.status, AudioTranscript.survey_id == survey_id)
    # Kobo's own transcripts (typed or made there) were never ours to send;
    # ours corrected in Kobo still count as "corrected in Kobo".
    kobos_own = (AudioTranscript.source == SOURCE_KOBO) & (AudioTranscript.kobo_status == "sent")
    kobo = count_by(
        db, AudioTranscript.kobo_status, AudioTranscript.survey_id == survey_id, ~kobos_own
    )
    from_kobo = (
        db.query(func.count(AudioTranscript.transcript_id))
        .filter(AudioTranscript.survey_id == survey_id, kobos_own)
        .scalar()
    )
    no_speech = (
        db.query(func.count(AudioTranscript.transcript_id))
        .filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.status == "success",
            func.coalesce(func.trim(AudioTranscript.text), "") == "",
        )
        .scalar()
    )
    unsent = (
        db.query(func.count(AudioTranscript.transcript_id))
        .filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.status == "success",
            AudioTranscript.kobo_status.in_(("not_sent", "failed")),
            func.coalesce(func.trim(AudioTranscript.text), "") != "",
        )
        .scalar()
    )
    return {
        "total": sum(status.values()),
        "success": status.get("success", 0),
        "in_progress": status.get("pending", 0) + status.get("running", 0),
        "failed": status.get("failed", 0),
        # Counted as translation counts them: work held back (allowance, a
        # cancelled run) apart from recordings that cannot be transcribed.
        "not_run": status.get("not_run_allowance", 0) + status.get("cancelled", 0),
        "skipped": status.get("skipped", 0),
        "no_speech": no_speech or 0,
        "from_kobo": from_kobo or 0,
        "kobo": {
            "sent": kobo.get("sent", 0),
            "edited_in_kobo": kobo.get("edited_in_kobo", 0),
            "failed": kobo.get("failed", 0),
            "unsupported": kobo.get("unsupported", 0),
            "pending": kobo.get("pending", 0),
            "unsent": unsent or 0,
        },
    }


def _settings_payload(db: Session, survey: SurveyConfig, user: User) -> dict[str, Any]:
    settings = transcription_settings(survey.config_data)
    used = seconds_used(db, survey.survey_id)
    limit = minutes_per_survey_month()
    key = resolve_transcription_key(db, survey)
    client = client_for(key)
    permission = get_user_permission(db, user, survey.survey_id)
    return {
        "available": client.available,
        "model": client.model,
        # Whose ElevenLabs key transcribes this survey: the owner's ("own"),
        # Field Compass's within the allowance ("operator"), or none yet.
        "key": {
            "source": key.source,
            "paused": key.paused_error.split(": ", 1)[-1] if key.paused_error else None,
            "label": key.label,
            "viewer_is_owner": survey.user_id == user.user_id,
            "own_minutes": round(seconds_on_own_key(db, survey.survey_id) / 60, 1)
            if key.source == OWN
            else None,
        },
        "settings": {
            "enabled": settings.enabled,
            "questions": list(settings.questions),
            "language": settings.language,
            "multiple_speakers": settings.multiple_speakers,
            "send_to_kobo": settings.send_to_kobo,
            "acknowledged_at": settings.acknowledged_at,
            "kobo_pause": settings.kobo_pause,
        },
        "audio_questions": [
            {"path": q.path, "name": q.name, "label": q.label, "in_repeat": q.in_repeat}
            for q in audio_questions(survey.config_data)
        ],
        "form_languages": [
            {
                "label": lang.label,
                "code": lang.code,
                "name": language_name(lang.code) if lang.code else None,
            }
            for lang in form_languages(_form_language_labels(survey.config_data))
        ],
        "languages": scribe_languages(),
        "allowance": {
            "month": month_start().strftime("%Y-%m"),
            "limit_minutes": limit,
            "used_minutes": round(used / 60, 1),
            "remaining_minutes": round(max(0.0, limit * 60 - used) / 60, 1),
            "max_recording_minutes": max_recording_seconds() // 60,
        },
        "counts": _counts(db, survey.survey_id),
        "can_edit": permission in ("owner", "admin"),
    }


@router.get("/surveys/{survey_id}/audio-transcription")
async def get_transcription_settings(
    survey: SurveyConfig = Depends(survey_access("viewer")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    The survey's transcription settings and everything the settings card needs:
    the form's audio questions, the languages Scribe can transcribe (the form's
    own first), this month's minutes, and how many transcripts were made and
    sent to Kobo.
    """
    return _settings_payload(db, survey, current_user)


class TranscriptionSettingsUpdate(BaseModel):
    enabled: bool = False
    questions: list[str] = Field(default_factory=list)
    language: str | None = None
    multiple_speakers: bool = False
    send_to_kobo: bool = False
    # Turning transcription on needs the owner to accept that recordings are
    # sent to ElevenLabs, once.
    acknowledge: bool = False


@router.put("/surveys/{survey_id}/audio-transcription")
async def update_transcription_settings(
    body: TranscriptionSettingsUpdate,
    survey: SurveyConfig = Depends(survey_access("owner")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Save the survey's transcription settings (owner). Saving resumes a paused Kobo send."""
    questions = {q.path: q for q in audio_questions(survey.config_data)}

    chosen: list[str] = []
    for path in body.questions:
        question = questions.get(path)
        if question is None:
            raise HTTPException(
                status_code=400, detail=f"“{path}” is not an audio question in this form."
            )
        if question.in_repeat:
            raise HTTPException(
                status_code=400,
                detail=f"“{question.label}” is inside a repeat group; those can't be transcribed yet.",
            )
        if path not in chosen:
            chosen.append(path)
    if body.enabled and not chosen:
        raise HTTPException(
            status_code=400, detail="Choose at least one audio question to transcribe."
        )

    language = None
    if body.language:
        language = normalize_language(body.language)
        if language is None:
            raise HTTPException(
                status_code=400, detail=f"Scribe can't transcribe “{body.language}”."
            )

    current = transcription_settings(survey.config_data)
    acknowledged_at, acknowledged_by = current.acknowledged_at, current.acknowledged_by
    if body.enabled and not acknowledged_at:
        if not body.acknowledge:
            raise HTTPException(
                status_code=400,
                detail="Confirm that recordings may be sent to ElevenLabs before turning transcription on.",
            )
        acknowledged_at = datetime.utcnow().isoformat() + "Z"
        acknowledged_by = str(current_user.user_id)

    config = dict(survey.config_data or {})
    config[SETTINGS_KEY] = {
        "enabled": body.enabled,
        "questions": chosen,
        "language": language,
        "multiple_speakers": body.multiple_speakers,
        "send_to_kobo": body.send_to_kobo,
        "acknowledged_at": acknowledged_at,
        "acknowledged_by": acknowledged_by,
        # Saving again is how the owner says a Kobo problem is fixed.
        "kobo_pause": None,
    }
    survey.config_data = config
    survey.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(survey)
    return _settings_payload(db, survey, current_user)


def _require_kobo_token(user: User) -> str:
    token = get_user_kobo_token(user)
    if not token:
        raise HTTPException(
            status_code=400,
            detail="Add your Kobo API key in Account settings first: recordings are read from Kobo with it.",
        )
    return token


def _recording_count(db: Session, survey: SurveyConfig) -> int:
    questions = selected_questions(survey.config_data)
    if not questions:
        return 0
    count = 0
    rows = db.query(SubmissionCurrent.submission_data).filter(
        SubmissionCurrent.survey_id == survey.survey_id
    )
    for (data,) in rows:
        for question in questions:
            if answer_filename(data or {}, question):
                count += 1
    return count


@router.get("/surveys/{survey_id}/transcripts/estimate")
async def estimate_transcription(
    survey: SurveyConfig = Depends(survey_access("owner")),
    mode: str = Query("missing", pattern="^(missing|all)$"),
    db: Session = Depends(get_db),
):
    """
    How much "Transcribe now" would send: recordings, minutes already known,
    and what is left of this month's allowance.
    """
    recordings = _recording_count(db, survey)
    # Recordings with a transcript in Kobo are never transcribed here.
    in_kobo = (
        db.query(func.count(AudioTranscript.transcript_id))
        .filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.source == SOURCE_KOBO,
            AudioTranscript.question_path.in_(
                [q.path for q in selected_questions(survey.config_data)]
            ),
        )
        .scalar()
        or 0
    )
    done = (
        db.query(func.count(AudioTranscript.transcript_id))
        .filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.status.in_(("success", "skipped", "pending", "running")),
        )
        .scalar()
        or 0
    )
    known_seconds = (
        db.query(func.coalesce(func.sum(AudioTranscript.audio_seconds), 0))
        .filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.source != SOURCE_KOBO,
        )
        .scalar()
    )
    remaining = max(0.0, minutes_per_survey_month() * 60 - seconds_used(db, survey.survey_id))
    return {
        "mode": mode,
        "recordings": max(0, recordings - in_kobo) if mode == "all" else max(0, recordings - done),
        "known_minutes": round(float(known_seconds or 0) / 60, 1) if mode == "all" else None,
        "remaining_minutes": round(remaining / 60, 1),
    }


@router.post("/surveys/{survey_id}/transcripts/run", status_code=202)
async def transcribe_now(
    survey: SurveyConfig = Depends(survey_access("owner")),
    mode: str = Query("missing", pattern="^(missing|all)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Transcribe recordings already pulled, without waiting for the next pull
    (owner). ``missing``: those with no transcript yet, or whose last attempt
    can be retried. ``all``: every recording again.
    """
    _require_kobo_token(current_user)
    settings = transcription_settings(survey.config_data)
    if not settings.active:
        raise HTTPException(
            status_code=400, detail="Turn transcription on and choose questions first."
        )

    run = start_background_run(db, survey, TRANSCRIPTION_RERUN, current_user, stats={"mode": mode})
    if mode == "all":
        db.query(AudioTranscript).filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.status.notin_(ITEM_OPEN),
            AudioTranscript.source != SOURCE_KOBO,
        ).update({AudioTranscript.input_hash: None}, synchronize_session=False)

    queuer = TranscriptionQueuer(db, survey, run_id=run.run_id, user_id=current_user.user_id)
    submissions = (
        db.query(SubmissionCurrent)
        .filter(SubmissionCurrent.survey_id == survey.survey_id)
        .order_by(SubmissionCurrent._submission_time.desc())
        .all()
    )
    for submission in submissions:
        rows = queuer.consider(submission)
        if rows:
            db.flush()
            queuer.queue(rows)
    from services.runs import update_stats

    update_stats(run, **dict(queuer.stats))
    db.commit()
    queuer.dispatch()
    finish_if_done(db, run.run_id)
    db.refresh(run)
    return run_summary(db, run, survey)


@router.post("/surveys/{survey_id}/transcripts/send-to-kobo", status_code=202)
async def send_transcripts_to_kobo(
    survey: SurveyConfig = Depends(survey_access("owner")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Send every transcript not yet in Kobo (or that failed to send) to Kobo (owner)."""
    _require_kobo_token(current_user)
    settings = transcription_settings(survey.config_data)
    if not settings.send_to_kobo:
        raise HTTPException(status_code=400, detail="Turn on “Send transcripts to Kobo” first.")
    if settings.kobo_pause:
        raise HTTPException(
            status_code=409,
            detail=settings.kobo_pause.get("message")
            or "Sending to Kobo is paused. Save the settings again to resume.",
        )

    rows = (
        db.query(AudioTranscript)
        .filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.status == "success",
            AudioTranscript.source != SOURCE_KOBO,
            AudioTranscript.kobo_status.in_(("not_sent", "failed")),
        )
        .all()
    )
    rows = [row for row in rows if (row.text or "").strip()]
    run = start_background_run(
        db, survey, KOBO_RESEND, current_user, stats={"kobo_queued": len(rows)}
    )
    jobs: list[tuple[AudioTranscript, str]] = []
    for row in rows:
        row.requested_by_user_id = current_user.user_id
        jobs.append((row, queue_kobo_send(db, row, run.run_id)))
    db.commit()
    for row, task_id in jobs:
        dispatch_kobo_send(db, row, task_id, run.run_id)
    finish_if_done(db, run.run_id)
    db.refresh(run)
    return run_summary(db, run, survey)


def _submission(db: Session, kobo_id: int, user: User) -> tuple[SubmissionCurrent, SurveyConfig]:
    submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == kobo_id).first()
    if submission is None:
        raise HTTPException(status_code=404, detail=f"Submission {kobo_id} not found")
    survey = require_survey_access(db, user, submission.survey_id, min_level="viewer")
    return submission, survey


@router.get("/submissions/{kobo_id}/transcripts")
async def get_submission_transcripts(
    kobo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Every answered audio question of a submission: whether it has a
    recording to play, and its transcript and Kobo status when transcribed.
    """
    submission, survey = _submission(db, kobo_id, current_user)
    settings = transcription_settings(survey.config_data)
    rows = {
        row.question_path: row
        for row in db.query(AudioTranscript).filter(
            AudioTranscript.survey_id == survey.survey_id,
            AudioTranscript.submission_id == submission._id,
        )
    }
    data = submission.submission_data or {}
    answers = []
    for question in audio_questions(survey.config_data):
        filename = answer_filename(data, question)
        row = rows.get(question.path)
        if filename is None and row is None:
            continue
        attachment = find_attachment(data, question, filename) if filename else None
        answers.append(
            {
                "question_path": question.path,
                "label": question.label,
                "filename": filename,
                "has_recording": bool(attachment and attachment.url and not attachment.deleted),
                "transcribed": question.path in settings.questions and settings.enabled,
                "transcript": None
                if row is None
                else {
                    # "kobo": the transcript Kobo shows, typed or made there.
                    "source": row.source,
                    "status": row.status,
                    "skip_reason": row.skip_reason,
                    "text": row.text,
                    "segments": row.segments,
                    "language_code": row.language_code,
                    "language_name": language_name(row.language_code),
                    "language_probability": float(row.language_probability)
                    if row.language_probability is not None
                    else None,
                    "audio_seconds": float(row.audio_seconds)
                    if row.audio_seconds is not None
                    else None,
                    "last_error": row.last_error,
                    "finished_at": iso(row.finished_at),
                    "kobo_status": row.kobo_status,
                    "kobo_last_error": row.kobo_last_error,
                    "kobo_sent_at": iso(row.kobo_sent_at),
                },
            }
        )
    return {
        "enabled": settings.active,
        "send_to_kobo": settings.send_to_kobo,
        "expected_language": settings.language,
        "answers": answers,
    }


@router.get("/submissions/{kobo_id}/audio")
async def stream_submission_audio(
    kobo_id: int,
    question: str = Query(..., description="The audio question's path"),
    range_header: str | None = Header(None, alias="Range"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Play a recording: streamed from Kobo with the viewer's own Kobo key, so
    nobody hears a recording they could not open in Kobo. Never stored here.
    """
    submission, survey = _submission(db, kobo_id, current_user)
    token = _require_kobo_token(current_user)
    match = next((q for q in audio_questions(survey.config_data) if q.path == question), None)
    if match is None:
        raise HTTPException(status_code=404, detail="No such audio question in this form.")
    data = submission.submission_data or {}
    filename = answer_filename(data, match)
    attachment = find_attachment(data, match, filename) if filename else None
    if attachment is None or not attachment.url or attachment.deleted:
        raise HTTPException(status_code=404, detail="This answer has no recording.")

    fetcher = KoboFetcher(
        api_token=token, api_url=current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    )
    try:
        upstream = fetcher.open_attachment(attachment.url, range_header)
    except KoboFetchError as exc:
        if exc.status in (401, 403):
            raise HTTPException(
                status_code=403, detail="Kobo won't let your account open this recording."
            ) from exc
        if exc.status == 404:
            raise HTTPException(
                status_code=404, detail="Kobo no longer has this recording."
            ) from exc
        raise HTTPException(
            status_code=502, detail="Could not load the recording from Kobo."
        ) from exc

    headers = {"Cache-Control": "private, max-age=300", "Accept-Ranges": "bytes"}
    for name in ("Content-Length", "Content-Range"):
        if upstream.headers.get(name):
            headers[name] = upstream.headers[name]

    def body():
        try:
            yield from upstream.iter_content(chunk_size=65536)
        finally:
            upstream.close()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("Content-Type") or attachment.mimetype or "audio/mp4",
        headers=headers,
    )

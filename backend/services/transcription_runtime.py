"""
Transcribing one recording: download it from Kobo, check its length and the
allowance, send it to ElevenLabs, store the transcript, and pass it on (to
Kobo, to the built-in checks, to translation, to an AI review waiting for it).

The recording only ever exists in a temporary directory that is removed when
the job ends, whatever happens. See docs/specs/audio-transcription.md, 4.2.
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from datetime import datetime
from typing import Any

if "/app" not in sys.path and os.path.isdir("/app"):
    sys.path.insert(0, "/app")

from database.models import ITEM_OPEN, AudioTranscript, SubmissionCurrent, SurveyConfig, User
from etl.audio import (
    audio_questions,
    is_transcription_issue,
    transcript_issues,
    transcription_settings,
)
from etl.kobo_fetcher import KoboFetcher, KoboFetchError
from etl.translation import translation_settings
from services.ai_errors import AUTH, NOT_CONFIGURED, PROVIDER_QUOTA, AIError
from services.audio_files import AudioFile, prepare_for_upload, probe_duration
from services.auth import get_user_kobo_token
from services.database import SessionLocal
from services.runs import (
    fail_stalled_items,
    fail_stalled_kobo_sends,
    finish_if_done,
    notify_pause,
)
from services.transcription_allowance import (
    max_recording_seconds,
    not_run_message,
    record_own_key_call,
    reserve,
    settle,
)
from services.transcription_keys import (
    OWN,
    client_for,
    note_own_key_outcome,
    resolve_transcription_key,
)
from services.transcription_queue import (
    dispatch_kobo_send,
    queue_kobo_send,
)

logger = logging.getLogger(__name__)

# Reserved for a recording ffprobe could not measure; settled to the real
# length once ElevenLabs reports it.
_UNKNOWN_LENGTH_RESERVATION = 60.0


def _finish(
    db, row: AudioTranscript, status: str, *, error: str | None = None, skip: str | None = None
):
    row.status = status
    row.last_error = error[:1000] if error else None
    row.skip_reason = skip
    row.finished_at = datetime.utcnow()
    db.commit()


def _kobo_fetcher(db, row: AudioTranscript, survey: SurveyConfig) -> KoboFetcher | None:
    """The fetcher of whoever asked for this transcript, else the survey's owner."""
    for user_id in (row.requested_by_user_id, survey.user_id):
        if not user_id:
            continue
        user = db.query(User).filter(User.user_id == user_id).first()
        token = get_user_kobo_token(user) if user else None
        if token:
            return KoboFetcher(
                api_token=token, api_url=user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
            )
    return None


def refresh_transcript_issues(db, survey: SurveyConfig, submission: SubmissionCurrent) -> None:
    """Replace this submission's built-in transcript findings and re-derive its status."""
    from etl.hfc_engine import HFCEngine
    from services.ai_review_queue import transcript_views

    settings = transcription_settings(survey.config_data)
    labels = {q.path: q.label for q in audio_questions(survey.config_data)}
    views = list(transcript_views(db, survey.survey_id, submission._id).values())
    issues = transcript_issues(views, labels, settings.language)
    existing = submission.data_quality_issues or []
    kept = [issue for issue in existing if not is_transcription_issue(issue)]
    if kept == existing and not issues:
        return
    submission.data_quality_issues = kept + issues
    engine = HFCEngine(db, survey)
    status = engine.determine_qa_status(
        submission.data_quality_issues, kobo_validation_status=submission.kobo_validation_status
    )
    if status is not None:
        submission.qa_status = status


def resume_waiting_review(db, survey: SurveyConfig, submission: SubmissionCurrent) -> None:
    """Queue the AI review that was waiting for this submission's transcripts."""
    if submission.llm_check_status != "waiting":
        return
    from etl.hfc_engine import HFCEngine
    from services.ai_review_queue import AIReviewQueuer

    queuer = AIReviewQueuer(db, survey, HFCEngine(db, survey), run_id=submission.llm_run_id)
    outcome = queuer.consider(submission)
    db.commit()
    if outcome == "queued":
        queuer.dispatch()


def _after_success(db, row: AudioTranscript, survey: SurveyConfig) -> None:
    settings = transcription_settings(survey.config_data)
    submission = (
        db.query(SubmissionCurrent)
        .filter(
            SubmissionCurrent._id == row.submission_id,
            SubmissionCurrent.survey_id == survey.survey_id,
        )
        .first()
    )
    if submission is not None:
        refresh_transcript_issues(db, survey, submission)
        db.commit()
    if settings.sending_to_kobo and row.text:
        task_id = queue_kobo_send(db, row, row.run_id)
        db.commit()
        dispatch_kobo_send(db, row, task_id, row.run_id)
    if translation_settings(survey.config_data).active:
        try:
            queue_translation(db, row, survey)
        except Exception:
            db.rollback()
            logger.exception("Could not queue the translation of transcript %s", row.transcript_id)


def queue_translation(db, row: AudioTranscript, survey: SurveyConfig) -> None:
    """Translate a transcript just made, as part of the run that made it."""
    from services.translation_queue import TranslationQueuer

    queuer = TranslationQueuer(db, survey, run_id=row.run_id, user_id=row.requested_by_user_id)
    translation = queuer.consider_transcript(row)
    if translation is None:
        return
    db.flush()
    queuer.queue([translation])
    db.commit()
    queuer.dispatch()


def _after_any(db, row: AudioTranscript, survey: SurveyConfig | None) -> None:
    """Whatever the outcome: a waiting review can go, and the run may be done."""
    if survey is not None:
        submission = (
            db.query(SubmissionCurrent)
            .filter(
                SubmissionCurrent._id == row.submission_id,
                SubmissionCurrent.survey_id == survey.survey_id,
            )
            .first()
        )
        if submission is not None:
            try:
                resume_waiting_review(db, survey, submission)
            except Exception:
                db.rollback()
                logger.exception(
                    "Could not resume the AI review of submission %s", row.submission_id
                )
    finish_if_done(db, row.run_id)


def run_transcription_job(  # noqa: C901 -- split pending, see docs/code-quality-review.md
    payload: dict[str, Any], job_id: str, final_attempt: bool = True
) -> dict[str, Any]:
    """
    Transcribe one recording. A retryable failure with attempts left leaves
    the transcript pending and raises the AIError for the task to retry.
    """
    db = SessionLocal()
    row: AudioTranscript | None = None
    survey: SurveyConfig | None = None
    try:
        transcript_id = int(payload["transcript_id"])
        row = (
            db.query(AudioTranscript)
            .filter(AudioTranscript.transcript_id == transcript_id)
            .with_for_update()
            .first()
        )
        if row is None:
            db.commit()
            return {"status": "missing"}
        if row.input_hash != payload.get("input_hash") or row.status not in ITEM_OPEN:
            db.commit()
            return {"status": "stale", "transcript_id": transcript_id}

        survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == row.survey_id).first()
        settings = transcription_settings(survey.config_data if survey else None)
        if survey is None or not settings.active or row.question_path not in settings.questions:
            _finish(
                db,
                row,
                "cancelled",
                error="cancelled: Transcription was turned off for this question.",
            )
            _after_any(db, row, survey)
            return {"status": "cancelled"}

        # The owner's own ElevenLabs key, or Field Compass's within the allowance.
        key = resolve_transcription_key(db, survey)
        client = client_for(key)
        if not client.available:
            _finish(
                db,
                row,
                "failed",
                error=f"{NOT_CONFIGURED}: Transcription is not set up on this server.",
            )
            _after_any(db, row, survey)
            return {"status": "failed", "category": NOT_CONFIGURED}
        paused = key.paused_error
        if paused:
            _finish(db, row, "failed", error=paused)
            _after_any(db, row, survey)
            return {"status": "failed", "category": paused.split(":", 1)[0]}

        row.status = "running"
        row.job_id = job_id
        row.started_at = datetime.utcnow()
        row.last_error = None
        db.commit()

        fetcher = _kobo_fetcher(db, row, survey)
        if fetcher is None:
            _finish(
                db,
                row,
                "failed",
                error="kobo_auth: No Kobo API key to download the recording with.",
            )
            _after_any(db, row, survey)
            return {"status": "failed", "category": "kobo_auth"}

        with tempfile.TemporaryDirectory(prefix="fc-audio-") as workdir:
            filename = os.path.basename(row.attachment_filename or "recording")
            local = os.path.join(workdir, filename or "recording")
            try:
                fetcher.download_attachment(row.attachment_url or "", local)
            except KoboFetchError as exc:
                if exc.status in (401, 403):
                    _finish(
                        db,
                        row,
                        "failed",
                        error="kobo_auth: Kobo rejected the API key for this recording.",
                    )
                elif exc.status in (404, 410):
                    _finish(db, row, "skipped", skip="missing_file")
                elif exc.status == 413:
                    _finish(db, row, "skipped", skip="too_long")
                elif not final_attempt:
                    row.status = "pending"
                    row.last_error = f"unavailable: {exc} (retrying)"[:1000]
                    db.commit()
                    raise AIError("unavailable", str(exc)) from exc
                else:
                    _finish(db, row, "failed", error=f"unavailable: {exc}")
                _after_any(db, row, survey)
                return {"status": row.status}

            duration = probe_duration(local)
            if duration is not None and duration > max_recording_seconds():
                row.audio_seconds = round(duration, 2)
                _finish(db, row, "skipped", skip="too_long")
                _after_any(db, row, survey)
                return {"status": "skipped", "reason": "too_long"}

            audio = prepare_for_upload(
                AudioFile(path=local, filename=filename, mimetype=None), workdir
            )
            # On Field Compass's key the minutes are reserved first; on the
            # owner's own key nothing is limited here, only recorded after.
            reservation = None
            if key.counts_against_allowance:
                reservation = reserve(
                    db,
                    survey.survey_id,
                    duration if duration is not None else _UNKNOWN_LENGTH_RESERVATION,
                    model=client.model,
                    submission_id=row.submission_id,
                    billed_user_id=survey.user_id,
                )
            if key.counts_against_allowance and reservation is None:
                _finish(db, row, "not_run_allowance", error=not_run_message())
                _after_any(db, row, survey)
                return {"status": "not_run_allowance"}

            try:
                result = client.transcribe(
                    audio,
                    language=settings.language,
                    diarize=settings.multiple_speakers,
                    duration_seconds=duration,
                )
            except AIError as error:
                if reservation is not None:
                    settle(db, reservation, error.category)
                elif key.source == OWN:
                    record_own_key_call(
                        db,
                        survey.survey_id,
                        connection_id=key.connection_id,
                        model=client.model,
                        submission_id=row.submission_id,
                        billed_user_id=survey.user_id,
                        outcome=error.category,
                        seconds=None,
                    )
                    note_own_key_outcome(db, key, error.category)
                if error.category in (AUTH, PROVIDER_QUOTA):
                    whose = "your" if key.source == OWN else "the"
                    notify_pause(
                        db,
                        survey,
                        f"transcription_{error.category}",
                        f"Transcription paused: ElevenLabs rejected {whose} API key."
                        if error.category == AUTH
                        else f"Transcription paused: {whose} ElevenLabs account is out of credit.",
                        run_id=row.run_id,
                        extra_user_ids=[row.requested_by_user_id],
                        link={"view": "userSettings", "tab": "ai"}
                        if key.source == OWN
                        else {"view": "dashboard", "survey_id": str(survey.survey_id)},
                    )
                    db.commit()
                    if key.source == OWN:
                        error = AIError(
                            error.category,
                            f"ElevenLabs refused your key “{key.label}”. Check or replace it in "
                            "Account settings › AI integration.",
                        )
                if error.retryable and not final_attempt:
                    row.status = "pending"
                    row.last_error = f"{error} (retrying)"[:1000]
                    db.commit()
                    raise
                _finish(db, row, "failed", error=str(error))
                _after_any(db, row, survey)
                return {"status": "failed", "category": error.category}

            seconds = result.audio_seconds if result.audio_seconds is not None else duration
            if reservation is not None:
                settle(db, reservation, "ok", seconds)
            else:
                record_own_key_call(
                    db,
                    survey.survey_id,
                    connection_id=key.connection_id,
                    model=client.model,
                    submission_id=row.submission_id,
                    billed_user_id=survey.user_id,
                    outcome="ok",
                    seconds=seconds,
                )
                note_own_key_outcome(db, key, "ok")

        row.text = result.text
        row.segments = result.segments
        row.language_code = result.language_code
        row.language_probability = result.language_probability
        row.audio_seconds = round(seconds, 2) if seconds is not None else None
        row.model = client.model
        _finish(db, row, "success")
        _after_success(db, row, survey)
        _after_any(db, row, survey)
        return {"status": "success", "transcript_id": transcript_id}
    except AIError:
        raise  # retryable, stored as pending above
    except Exception as exc:
        logger.error("Transcription job failed: %s", exc, exc_info=True)
        db.rollback()
        if row is not None:
            try:
                failed = (
                    db.query(AudioTranscript)
                    .filter(AudioTranscript.transcript_id == row.transcript_id)
                    .first()
                )
                if failed is not None and failed.status in ITEM_OPEN:
                    _finish(db, failed, "failed", error=f"internal: {exc}")
                    _after_any(db, failed, survey)
            except Exception:  # noqa: BLE001 -- recording the failure must not mask it
                db.rollback()
        raise
    finally:
        db.close()


def sweep_stalled_transcripts(db, now: datetime | None = None) -> int:
    """Fail transcriptions that lost their worker, and their Kobo sends."""
    now = now or datetime.utcnow()
    stalled = fail_stalled_items(db, AudioTranscript, now, "transcription")
    kobo_stalled = fail_stalled_kobo_sends(db, AudioTranscript, now)
    db.commit()

    # A review waiting on a transcript that just failed can go now, without it.
    for row in stalled:
        survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == row.survey_id).first()
        submission = (
            db.query(SubmissionCurrent)
            .filter(
                SubmissionCurrent._id == row.submission_id,
                SubmissionCurrent.survey_id == row.survey_id,
            )
            .first()
        )
        if survey is not None and submission is not None:
            try:
                resume_waiting_review(db, survey, submission)
            except Exception:  # noqa: BLE001 -- one review must not stop the sweep
                db.rollback()
    return len(stalled) + kobo_stalled

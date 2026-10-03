"""
Background task: send one transcript to Kobo as the question's transcript.

Never overwrites a correction made in Kobo: once we have sent a version, a
newer transcript is only sent if the version Kobo shows is still ours. After
three permission failures in a row (or a server without the supplement API),
sending pauses for the survey and its owner is told; saving the transcription
settings again resumes it. See docs/specs/audio-transcription.md, section 5.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime
from typing import Any

from database.models import AudioTranscript, SubmissionCurrent, SurveyConfig, User
from etl.audio import LANGUAGE_MISMATCH_PROBABILITY, root_uuid, transcription_settings
from etl.kobo_fetcher import KoboFetcher
from services.auth import get_user_kobo_token
from services.database import SessionLocal
from services.job_queue import celery_app
from services.kobo_supplement import (
    KOBO_PERMISSION,
    UNSUPPORTED,
    KoboSupplementError,
    ensure_transcription_feature,
    read_supplement,
    selected_manual_version,
    send_transcript,
)
from services.runs import finish_if_done, notify_pause
from services.transcription_languages import kobo_language_code

logger = logging.getLogger(__name__)

PAUSE_AFTER_PERMISSION_FAILURES = 3


def _fetcher(db, row: AudioTranscript, survey: SurveyConfig) -> KoboFetcher | None:
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


def _pause(db, survey: SurveyConfig, reason: str, message: str, row: AudioTranscript) -> None:
    config = dict(survey.config_data or {})
    settings = dict(config.get("audio_transcription") or {})
    settings["kobo_pause"] = {
        "reason": reason,
        "message": message,
        "at": datetime.utcnow().isoformat() + "Z",
    }
    config["audio_transcription"] = settings
    survey.config_data = config  # reassigned so the JSON column is saved
    notify_pause(
        db,
        survey,
        f"kobo_{reason}",
        message,
        run_id=row.kobo_run_id,
        extra_user_ids=[row.requested_by_user_id],
    )


def transcript_language(row: AudioTranscript, survey_language: str | None) -> str | None:
    """
    The language a transcript is filed under in Kobo: the one Scribe heard,
    when it is sure, so an answer given in another language is not labelled
    as the survey's; otherwise the survey's.
    """
    confident = (
        row.language_code
        and row.language_probability is not None
        and float(row.language_probability) >= LANGUAGE_MISMATCH_PROBABILITY
    )
    if confident:
        return row.language_code
    return survey_language or row.language_code


def _permission_failures_in_a_row(db, survey_id) -> int:
    recent = (
        db.query(AudioTranscript.kobo_status, AudioTranscript.kobo_last_error)
        .filter(
            AudioTranscript.survey_id == survey_id,
            AudioTranscript.kobo_attempted_at.isnot(None),
        )
        .order_by(AudioTranscript.kobo_attempted_at.desc())
        .limit(PAUSE_AFTER_PERMISSION_FAILURES)
        .all()
    )
    count = 0
    for status, error in recent:
        if status == "failed" and (error or "").startswith(KOBO_PERMISSION):
            count += 1
        else:
            break
    return count


def run_kobo_send_job(payload: dict[str, Any], final_attempt: bool = True) -> dict[str, Any]:
    db = SessionLocal()
    try:
        row = (
            db.query(AudioTranscript)
            .filter(AudioTranscript.transcript_id == int(payload["transcript_id"]))
            .with_for_update()
            .first()
        )
        if row is None or row.kobo_status != "pending":
            db.commit()
            return {"status": "stale"}
        run_id = row.kobo_run_id
        survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == row.survey_id).first()
        settings = transcription_settings(survey.config_data if survey else None)

        def done(status: str, error: str | None = None) -> dict[str, Any]:
            row.kobo_status = status
            row.kobo_last_error = error[:1000] if error else None
            row.kobo_attempted_at = datetime.utcnow()
            db.commit()
            finish_if_done(db, run_id)
            return {"status": status}

        if survey is None or not survey.kobo_asset_id or not settings.sending_to_kobo:
            row.kobo_status = "not_sent"
            db.commit()
            finish_if_done(db, run_id)
            return {"status": "not_sent"}
        if row.status != "success" or not (row.text or "").strip():
            row.kobo_status = "not_sent"
            db.commit()
            finish_if_done(db, run_id)
            return {"status": "not_sent"}

        language = kobo_language_code(transcript_language(row, settings.language))
        if not language:
            return done("failed", "bad_request: No language was detected for this recording.")
        submission = (
            db.query(SubmissionCurrent)
            .filter(
                SubmissionCurrent._id == row.submission_id,
                SubmissionCurrent.survey_id == row.survey_id,
            )
            .first()
        )
        root = root_uuid(submission.submission_data or {}) if submission else None
        if not root:
            return done(
                "failed", "not_found: This submission has no id Kobo can file a transcript under."
            )
        fetcher = _fetcher(db, row, survey)
        if fetcher is None:
            return done(
                "failed", f"{KOBO_PERMISSION}: No Kobo API key to send the transcript with."
            )

        try:
            if row.kobo_version_uuid:
                current = selected_manual_version(
                    read_supplement(fetcher, survey.kobo_asset_id, root), row.question_path
                )
                if current is None or str(current.get("_uuid")) != row.kobo_version_uuid:
                    # Someone corrected (or removed) it in Kobo: theirs stands.
                    return done("edited_in_kobo")
                current_data = current.get("_data") or {}
                if (
                    current_data.get("value") == row.text
                    and current_data.get("language") == language
                ):
                    return done("sent")
            ensure_transcription_feature(fetcher, survey.kobo_asset_id, row.question_path, language)
            version = send_transcript(
                fetcher, survey.kobo_asset_id, root, row.question_path, language, row.text or ""
            )
        except KoboSupplementError as error:
            if error.retryable and not final_attempt:
                row.kobo_last_error = f"{error} (retrying)"[:1000]
                db.commit()
                raise
            result = done("unsupported" if error.category == UNSUPPORTED else "failed", str(error))
            if error.category == UNSUPPORTED:
                _pause(
                    db,
                    survey,
                    "unsupported",
                    "This Kobo server doesn't support adding transcripts. Transcripts stay in Field Compass.",
                    row,
                )
                db.commit()
            elif (
                error.category == KOBO_PERMISSION
                and _permission_failures_in_a_row(db, survey.survey_id)
                >= PAUSE_AFTER_PERMISSION_FAILURES
            ):
                _pause(
                    db,
                    survey,
                    "permission",
                    "Sending to Kobo paused: your Kobo account can't edit this project's submissions. "
                    "Ask the project owner for permission to edit submissions, then save the transcription settings again.",
                    row,
                )
                db.commit()
            return result

        row.kobo_version_uuid = version
        row.kobo_language = language
        row.kobo_sent_at = datetime.utcnow()
        return done("sent")
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="services.kobo_sync_worker.send_transcript_to_kobo_task",
    max_retries=3,
    rate_limit="120/m",
)
def send_transcript_to_kobo_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return run_kobo_send_job(payload, final_attempt=self.request.retries >= self.max_retries)
    except KoboSupplementError as error:
        wait = min(30 * (2**self.request.retries) + random.uniform(0, 10), 300)
        if error.retry_after:
            wait = max(wait, min(error.retry_after, 300))
        raise self.retry(exc=Exception(str(error)), countdown=wait) from None

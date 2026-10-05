"""
Background tasks: send one transcript to Kobo as the question's transcript,
or one translation as the question's translation into its language.

Never overwrites a transcript made in Kobo: nothing is sent when Kobo already
shows a transcript of its own, and once we have sent a version, a newer one
is only sent if the version Kobo shows is still ours. After
three permission failures in a row (or a server without the supplement API),
sending pauses for the survey and its owner is told; saving the transcription
settings again resumes it. See docs/specs/audio-transcription.md, section 5.

A translation is sent only once Kobo shows the transcript it was made from,
under the same rules: a translation corrected in Kobo, or one Kobo made
itself, is never overwritten. See docs/specs/transcript-translation.md.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime
from typing import Any

from database.models import (
    AudioTranscript,
    SubmissionCurrent,
    SurveyConfig,
    TranscriptTranslation,
    User,
)
from etl.audio import (
    LANGUAGE_MISMATCH_PROBABILITY,
    root_uuid,
    transcription_settings,
    translation_input_hash,
)
from etl.kobo_fetcher import KoboFetcher
from services.auth import get_user_kobo_token
from services.database import SessionLocal
from services.job_queue import celery_app
from services.kobo_supplement import (
    KOBO_PERMISSION,
    NOT_FOUND,
    UNSUPPORTED,
    KoboSupplementError,
    ensure_transcription_feature,
    ensure_translation_feature,
    read_supplement,
    selected_transcript,
    selected_translation,
    send_transcript,
    send_translation,
)
from services.runs import finish_if_done, notify_pause
from services.transcription_languages import kobo_language_code

logger = logging.getLogger(__name__)

PAUSE_AFTER_PERMISSION_FAILURES = 3


def _fetcher(
    db, row: AudioTranscript | TranscriptTranslation, survey: SurveyConfig
) -> KoboFetcher | None:
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
            try:
                current = selected_transcript(
                    read_supplement(fetcher, survey.kobo_asset_id, root), row.question_path
                )
            except KoboSupplementError as error:
                # Nothing filed for this submission yet, or a server without
                # the supplement API (found out when enabling the feature).
                if row.kobo_version_uuid or error.category != NOT_FOUND:
                    raise
                current = None
            if row.kobo_version_uuid:
                if current is None or str(current.get("_uuid")) != row.kobo_version_uuid:
                    # Someone corrected (or removed) it in Kobo: theirs stands.
                    return done("edited_in_kobo")
                current_data = current.get("_data") or {}
                if (
                    current_data.get("value") == row.text
                    and current_data.get("language") == language
                ):
                    result = done("sent")
                    _send_its_translation(db, row, run_id)
                    return result
            elif current is not None and (current.get("_data") or {}).get("value"):
                # Kobo got a transcript of its own since the pull: it stands,
                # and the next pull shows it.
                return done("edited_in_kobo")
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
        result = done("sent")
        _send_its_translation(db, row, run_id)
        return result
    finally:
        db.close()


def _send_its_translation(db, transcript: AudioTranscript, run_id) -> None:
    """The transcript is in Kobo now: its translation can follow."""
    from services.translation_queue import send_translation_when_ready

    try:
        send_translation_when_ready(db, transcript, run_id)
    except Exception:
        db.rollback()
        logger.exception(
            "Could not queue the translation of transcript %s", transcript.transcript_id
        )


def run_translation_kobo_send_job(
    payload: dict[str, Any], final_attempt: bool = True
) -> dict[str, Any]:
    from services.translation_queue import in_kobo

    db = SessionLocal()
    try:
        row = (
            db.query(TranscriptTranslation)
            .filter(TranscriptTranslation.translation_id == int(payload["translation_id"]))
            .with_for_update()
            .first()
        )
        if row is None or row.kobo_status != "pending":
            db.commit()
            return {"status": "stale"}
        run_id = row.kobo_run_id
        survey = db.get(SurveyConfig, row.survey_id)
        transcript = db.get(AudioTranscript, row.transcript_id)
        settings = transcription_settings(survey.config_data if survey else None)

        def done(status: str, error: str | None = None) -> dict[str, Any]:
            row.kobo_status = status
            row.kobo_last_error = error[:1000] if error else None
            row.kobo_attempted_at = datetime.utcnow()
            db.commit()
            finish_if_done(db, run_id)
            return {"status": status}

        def not_sent() -> dict[str, Any]:
            row.kobo_status = "not_sent"
            db.commit()
            finish_if_done(db, run_id)
            return {"status": "not_sent"}

        if survey is None or not survey.kobo_asset_id or not settings.sending_to_kobo:
            return not_sent()
        if row.status != "success" or not (row.text or "").strip() or transcript is None:
            return not_sent()
        if not in_kobo(transcript) or row.input_hash != translation_input_hash(
            transcript.text, row.language
        ):
            # Kobo doesn't show the transcript this was made from (yet): sent
            # once it does, or translated again from the one it shows.
            return not_sent()

        language = kobo_language_code(row.language)
        if not language:
            return done("failed", f"bad_request: Kobo has no code for “{row.language}”.")
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
                "failed", "not_found: This submission has no id Kobo can file a translation under."
            )
        fetcher = _fetcher(db, row, survey)
        if fetcher is None:
            return done(
                "failed", f"{KOBO_PERMISSION}: No Kobo API key to send the translation with."
            )

        try:
            try:
                current = selected_translation(
                    read_supplement(fetcher, survey.kobo_asset_id, root),
                    row.question_path,
                    language,
                )
            except KoboSupplementError as error:
                # Nothing filed for this submission (as transcripts), or a
                # server without the supplement API.
                if row.kobo_version_uuid or error.category != NOT_FOUND:
                    raise
                current = None
            if row.kobo_version_uuid:
                if current is None or str(current.get("_uuid")) != row.kobo_version_uuid:
                    # Someone corrected (or removed) it in Kobo: theirs stands.
                    return done("edited_in_kobo")
                if (current.get("_data") or {}).get("value") == row.text:
                    return done("sent")
            elif current is not None and (current.get("_data") or {}).get("value"):
                # Kobo has a translation into this language of its own: it stands.
                return done("edited_in_kobo")
            ensure_translation_feature(fetcher, survey.kobo_asset_id, row.question_path, language)
            version = send_translation(
                fetcher, survey.kobo_asset_id, root, row.question_path, language, row.text or ""
            )
        except KoboSupplementError as error:
            if error.retryable and not final_attempt:
                row.kobo_last_error = f"{error} (retrying)"[:1000]
                db.commit()
                raise
            # Pausing is left to transcripts, which go first: a server or an
            # account that can't take one can't take the other.
            return done("unsupported" if error.category == UNSUPPORTED else "failed", str(error))

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


@celery_app.task(
    bind=True,
    name="services.kobo_sync_worker.send_translation_to_kobo_task",
    max_retries=3,
    rate_limit="120/m",
)
def send_translation_to_kobo_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return run_translation_kobo_send_job(
            payload, final_attempt=self.request.retries >= self.max_retries
        )
    except KoboSupplementError as error:
        wait = min(30 * (2**self.request.retries) + random.uniform(0, 10), 300)
        if error.retry_after:
            wait = max(wait, min(error.retry_after, 300))
        raise self.retry(exc=Exception(str(error)), countdown=wait) from None

"""
Runs: a pull (or a re-run) and the background work it started, as something
people can watch.

A run's progress is never stored as counters that could drift: it is counted
from the items that point back at it -- AI reviews
(``submissions_current.llm_run_id``), transcriptions
(``audio_transcripts.run_id``), translations
(``answer_translations.run_id``) and what was sent to Kobo
(``kobo_run_id`` on both). The run row holds what only the pull
knows (how many it fetched, how many it queued) and its stage.

See docs/specs/audio-transcription.md, part B.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database.models import (
    RUN_ACTIVE,
    RUN_OPEN,
    AnswerTranslation,
    AudioTranscript,
    Run,
    SubmissionCurrent,
    SurveyConfig,
    User,
)
from etl.audio import is_transcription_issue, transcription_settings
from services.ai_allowance import month_start
from services.notifications import PAUSED, RUN_FAILED, RUN_FINISHED, notify

logger = logging.getLogger(__name__)

PULL = "pull"
TRANSCRIPTION_RERUN = "transcription_rerun"
TRANSLATION_RERUN = "translation_rerun"
KOBO_RESEND = "kobo_resend"

OPEN_AI_STATUSES = ("pending", "running", "waiting")
OPEN_TRANSCRIPT_STATUSES = ("pending", "running")
OPEN_KOBO_STATUSES = ("pending",)

# Time left is estimated from what finished in this window, once this many
# items are done -- earlier guesses swing too much to be worth showing.
_RATE_WINDOW = timedelta(minutes=2)
_ETA_AFTER = 10

# A pull that has said nothing for this long has lost its worker.
STALLED_PULL_RUNNING = timedelta(hours=2)
STALLED_PULL_QUEUED = timedelta(hours=1)
KEEP_RUNS_FOR = timedelta(days=90)


class RunAlreadyActive(Exception):
    def __init__(self, run: Run):
        super().__init__("A pull is already running for this survey.")
        self.run = run


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def user_name(user: User | None) -> str | None:
    if user is None:
        return None
    return user.full_name or user.username or user.email


# --- Starting -----------------------------------------------------------------


def active_pull(db: Session, survey_id: UUID) -> Run | None:
    return (
        db.query(Run)
        .filter(Run.survey_id == survey_id, Run.status.in_(RUN_ACTIVE))
        .order_by(Run.created_at.desc())
        .first()
    )


def start_pull(db: Session, survey: SurveyConfig, user: User | None) -> Run:
    """A queued pull run; :class:`RunAlreadyActive` when one is under way."""
    existing = active_pull(db, survey.survey_id)
    if existing is not None:
        raise RunAlreadyActive(existing)
    run = Run(
        survey_id=survey.survey_id,
        kind=PULL,
        started_by_user_id=user.user_id if user else None,
        status="queued",
        stage="queued",
        stats={},
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        # Another request created one between the check and the insert.
        db.rollback()
        existing = active_pull(db, survey.survey_id)
        if existing is None:
            raise
        raise RunAlreadyActive(existing) from None
    return run


def start_background_run(
    db: Session, survey: SurveyConfig, kind: str, user: User | None, stats: dict | None = None
) -> Run:
    """A run with no pull: straight to its background work (re-runs, re-sends)."""
    now = datetime.utcnow()
    run = Run(
        survey_id=survey.survey_id,
        kind=kind,
        started_by_user_id=user.user_id if user else None,
        status="background",
        stage="background",
        stats=stats or {},
        started_at=now,
    )
    db.add(run)
    db.flush()
    return run


def update_stats(run: Run, **values: Any) -> None:
    stats = dict(run.stats or {})
    stats.update(values)
    run.stats = stats  # reassigned so the JSON column is marked changed


def stop_requested(db: Session, run_id: UUID) -> bool:
    stats = db.query(Run.stats).filter(Run.run_id == run_id).scalar()
    return bool((stats or {}).get("stop_requested"))


# --- Counting -----------------------------------------------------------------


def _group(db: Session, column, *filters) -> Counter:
    return Counter(dict(db.query(column, func.count()).filter(*filters).group_by(column).all()))


def _bucket(
    counts: Counter, queued_stat: int | None, open_statuses, done_statuses, failed_statuses
):
    present = sum(counts.values())
    handed_off = max(0, (queued_stat or 0) - present)
    open_count = sum(counts.get(s, 0) for s in open_statuses)
    done = sum(counts.get(s, 0) for s in done_statuses)
    failed = sum(counts.get(s, 0) for s in failed_statuses)
    return {
        "queued": present + handed_off,
        "done": done,
        "failed": failed,
        "not_run": present - open_count - done - failed,
        "open": open_count,
        "handed_off": handed_off,
    }


def _eta(open_count: int, finished: int, recent: int) -> int | None:
    if open_count <= 0 or finished < _ETA_AFTER or recent <= 0:
        return None
    rate = recent / _RATE_WINDOW.total_seconds()
    return round(open_count / rate)


def run_counts(db: Session, run: Run, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.utcnow()
    since = now - _RATE_WINDOW
    stats = run.stats or {}

    ai = _group(db, SubmissionCurrent.llm_check_status, SubmissionCurrent.llm_run_id == run.run_id)
    transcripts = _group(db, AudioTranscript.status, AudioTranscript.run_id == run.run_id)
    translations = _group(db, AnswerTranslation.status, AnswerTranslation.run_id == run.run_id)
    # Transcripts and translations sent to Kobo, together.
    kobo = _group(
        db, AudioTranscript.kobo_status, AudioTranscript.kobo_run_id == run.run_id
    ) + _group(db, AnswerTranslation.kobo_status, AnswerTranslation.kobo_run_id == run.run_id)

    out: dict[str, Any] = {
        "ai_checks": None,
        "transcripts": None,
        "translations": None,
        "kobo": None,
    }

    if ai or stats.get("llm_queued") or stats.get("llm_waiting"):
        bucket = _bucket(
            ai,
            (stats.get("llm_queued") or 0) + (stats.get("llm_waiting") or 0),
            OPEN_AI_STATUSES,
            ("success",),
            ("failed",),
        )
        recent = (
            db.query(func.count(SubmissionCurrent._id))
            .filter(
                SubmissionCurrent.llm_run_id == run.run_id,
                SubmissionCurrent.llm_checked_at >= since,
            )
            .scalar()
        )
        bucket["eta_seconds"] = _eta(bucket["open"], bucket["done"] + bucket["failed"], recent)
        out["ai_checks"] = bucket

    if transcripts or stats.get("transcripts_queued"):
        bucket = _bucket(
            transcripts,
            stats.get("transcripts_queued"),
            OPEN_TRANSCRIPT_STATUSES,
            ("success",),
            ("failed",),
        )
        seconds = (
            db.query(func.coalesce(func.sum(AudioTranscript.audio_seconds), 0))
            .filter(AudioTranscript.run_id == run.run_id, AudioTranscript.status == "success")
            .scalar()
        )
        recent = (
            db.query(func.count(AudioTranscript.transcript_id))
            .filter(AudioTranscript.run_id == run.run_id, AudioTranscript.finished_at >= since)
            .scalar()
        )
        bucket["minutes"] = round(float(seconds or 0) / 60, 1)
        bucket["flagged"] = _flagged_by_transcripts(db, run)
        bucket["eta_seconds"] = _eta(bucket["open"], bucket["done"] + bucket["failed"], recent)
        out["transcripts"] = bucket

    if translations or stats.get("translations_queued"):
        bucket = _bucket(
            translations,
            stats.get("translations_queued"),
            OPEN_TRANSCRIPT_STATUSES,
            ("success",),
            ("failed",),
        )
        recent = (
            db.query(func.count(AnswerTranslation.translation_id))
            .filter(
                AnswerTranslation.run_id == run.run_id,
                AnswerTranslation.finished_at >= since,
            )
            .scalar()
        )
        bucket["eta_seconds"] = _eta(bucket["open"], bucket["done"] + bucket["failed"], recent)
        out["translations"] = bucket

    if kobo:
        out["kobo"] = _bucket(
            kobo,
            None,
            OPEN_KOBO_STATUSES,
            ("sent",),
            ("failed", "unsupported"),
        )
        out["kobo"]["edited_in_kobo"] = kobo.get("edited_in_kobo", 0)

    return out


def _flagged_by_transcripts(db: Session, run: Run) -> int:
    """Submissions of this run with a built-in finding on a recording (no speech, another language)."""
    ids = [
        submission_id
        for (submission_id,) in db.query(AudioTranscript.submission_id)
        .filter(AudioTranscript.run_id == run.run_id, AudioTranscript.status == "success")
        .distinct()
    ]
    if not ids:
        return 0
    rows = db.query(SubmissionCurrent.data_quality_issues).filter(
        SubmissionCurrent.survey_id == run.survey_id, SubmissionCurrent._id.in_(ids)
    )
    return sum(1 for (issues,) in rows if any(is_transcription_issue(i) for i in issues or []))


def has_open_items(db: Session, run_id: UUID) -> bool:
    ai = (
        db.query(SubmissionCurrent._id)
        .filter(
            SubmissionCurrent.llm_run_id == run_id,
            SubmissionCurrent.llm_check_status.in_(OPEN_AI_STATUSES),
        )
        .first()
    )
    if ai is not None:
        return True
    transcript = (
        db.query(AudioTranscript.transcript_id)
        .filter(
            AudioTranscript.run_id == run_id,
            AudioTranscript.status.in_(OPEN_TRANSCRIPT_STATUSES),
        )
        .first()
    )
    if transcript is not None:
        return True
    kobo = (
        db.query(AudioTranscript.transcript_id)
        .filter(
            AudioTranscript.kobo_run_id == run_id,
            AudioTranscript.kobo_status.in_(OPEN_KOBO_STATUSES),
        )
        .first()
    )
    if kobo is not None:
        return True
    translation = (
        db.query(AnswerTranslation.translation_id)
        .filter(
            (
                (AnswerTranslation.run_id == run_id)
                & AnswerTranslation.status.in_(OPEN_TRANSCRIPT_STATUSES)
            )
            | (
                (AnswerTranslation.kobo_run_id == run_id)
                & AnswerTranslation.kobo_status.in_(OPEN_KOBO_STATUSES)
            )
        )
        .first()
    )
    return translation is not None


# --- Problems, in words ---------------------------------------------------------


def _categories(rows) -> Counter:
    counter: Counter = Counter()
    for (error,) in rows:
        counter[(error or "").split(":", 1)[0].strip() or "unknown"] += 1
    return counter


def _plural(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def run_problems(db: Session, run: Run, survey: SurveyConfig | None, counts: dict) -> list[dict]:
    """What went wrong or was held back, in words, with what to do about it."""
    problems: list[dict] = []
    month = month_start().strftime("%B")
    stats = run.stats or {}

    if stats.get("llm_paused"):
        problems.append(
            {
                "kind": "ai_paused",
                "text": "AI review paused: your AI provider is not working.",
                "action": "open_ai_providers",
            }
        )
    ai = counts.get("ai_checks")
    if ai:
        failed = _categories(
            db.query(SubmissionCurrent.llm_last_error).filter(
                SubmissionCurrent.llm_run_id == run.run_id,
                SubmissionCurrent.llm_check_status == "failed",
            )
        )
        if failed.get("auth"):
            problems.append(
                {
                    "kind": "ai_auth",
                    "text": "AI review stopped: the AI provider rejected the key.",
                    "action": "open_ai_providers",
                }
            )
        if failed.get("provider_quota"):
            problems.append(
                {
                    "kind": "ai_quota",
                    "text": "AI review stopped: the AI provider account is out of credit.",
                    "action": "open_ai_providers",
                }
            )
        if failed.get("not_configured"):
            problems.append(
                {
                    "kind": "ai_not_configured",
                    "text": "AI review is not set up on this server.",
                    "action": None,
                }
            )
        not_run = (
            db.query(func.count(SubmissionCurrent._id))
            .filter(
                SubmissionCurrent.llm_run_id == run.run_id,
                SubmissionCurrent.llm_check_status == "not_run_allowance",
            )
            .scalar()
        ) or (stats.get("llm_not_run_allowance") or 0)
        if not_run:
            problems.append(
                {
                    "kind": "ai_allowance",
                    "text": f"{_plural(not_run, 'answer')} not reviewed: this survey has used its included AI reviews for {month}.",
                    "action": "open_ai_usage",
                }
            )

    transcripts = counts.get("transcripts")
    if transcripts:
        failed = _categories(
            db.query(AudioTranscript.last_error).filter(
                AudioTranscript.run_id == run.run_id, AudioTranscript.status == "failed"
            )
        )
        if failed.get("auth"):
            own = (
                db.query(AudioTranscript.transcript_id)
                .filter(
                    AudioTranscript.run_id == run.run_id,
                    AudioTranscript.status == "failed",
                    AudioTranscript.last_error.like("%your key%"),
                )
                .first()
                is not None
            )
            problems.append(
                {
                    "kind": "transcription_auth",
                    "text": "Transcription stopped: ElevenLabs refused your key."
                    if own
                    else "Transcription stopped: ElevenLabs rejected the API key.",
                    "action": "open_ai_providers" if own else None,
                }
            )
        if failed.get("provider_quota"):
            problems.append(
                {
                    "kind": "transcription_quota",
                    "text": "Transcription stopped: the ElevenLabs account is out of credit.",
                    "action": None,
                }
            )
        if failed.get("not_configured"):
            problems.append(
                {
                    "kind": "transcription_not_configured",
                    "text": "Transcription is not set up on this server.",
                    "action": None,
                }
            )
        if failed.get("kobo_auth"):
            problems.append(
                {
                    "kind": "transcription_kobo_auth",
                    "text": "Couldn't download recordings: Kobo rejected the API key of the person who started this pull.",
                    "action": "open_kobo_settings",
                }
            )
        if failed.get("bad_request"):
            count = failed["bad_request"]
            problems.append(
                {
                    "kind": "transcription_bad_file",
                    "text": f"{_plural(count, 'recording')} couldn't be transcribed: the file format isn't supported or the file is damaged.",
                    "action": None,
                }
            )
        held = _group(
            db,
            AudioTranscript.status,
            AudioTranscript.run_id == run.run_id,
            AudioTranscript.status.in_(("not_run_allowance",)),
        ).get("not_run_allowance", 0)
        if held:
            from services.transcription_allowance import minutes_per_survey_month

            problems.append(
                {
                    "kind": "transcription_allowance",
                    "text": f"{_plural(held, 'recording')} not transcribed: this survey has used its {minutes_per_survey_month()} included minutes for {month}.",
                    "action": "open_ai_usage",
                }
            )
        too_long = (
            db.query(func.count(AudioTranscript.transcript_id))
            .filter(AudioTranscript.run_id == run.run_id, AudioTranscript.skip_reason == "too_long")
            .scalar()
        )
        if too_long:
            from services.transcription_allowance import max_recording_seconds

            problems.append(
                {
                    "kind": "transcription_too_long",
                    "text": f"{_plural(too_long, 'recording')} skipped: longer than {max_recording_seconds() // 60} minutes.",
                    "action": None,
                }
            )

    if counts.get("translations"):
        failed = _categories(
            db.query(AnswerTranslation.last_error).filter(
                AnswerTranslation.run_id == run.run_id,
                AnswerTranslation.status == "failed",
            )
        )
        if failed.get("auth"):
            problems.append(
                {
                    "kind": "translation_auth",
                    "text": "Translation stopped: the AI provider rejected the key.",
                    "action": "open_ai_providers",
                }
            )
        if failed.get("provider_quota"):
            problems.append(
                {
                    "kind": "translation_quota",
                    "text": "Translation stopped: the AI provider account is out of credit.",
                    "action": "open_ai_providers",
                }
            )
        if failed.get("not_configured"):
            problems.append(
                {
                    "kind": "translation_not_configured",
                    "text": "Translation needs an AI key: none is set up for this survey.",
                    "action": "open_ai_providers",
                }
            )
        held = (
            db.query(func.count(AnswerTranslation.translation_id))
            .filter(
                AnswerTranslation.run_id == run.run_id,
                AnswerTranslation.status == "not_run_allowance",
            )
            .scalar()
        )
        if held:
            problems.append(
                {
                    "kind": "translation_allowance",
                    "text": f"{_plural(held, 'answer')} not translated: this survey has used its included translations for {month}.",
                    "action": "open_ai_usage",
                }
            )

    if survey is not None and (counts.get("kobo") or counts.get("transcripts")):
        settings = transcription_settings(survey.config_data)
        pause = settings.kobo_pause if settings.send_to_kobo else None
        if pause:
            problems.append(
                {
                    "kind": f"kobo_{pause.get('reason', 'paused')}",
                    "text": pause.get("message") or "Sending transcripts to Kobo is paused.",
                    "action": "open_transcription_settings",
                }
            )

    if stats.get("errors"):
        count = stats["errors"]
        problems.append(
            {
                "kind": "pull_errors",
                "text": f"{_plural(count, 'submission')} couldn't be processed; the rest of the pull went through.",
                "action": None,
            }
        )
    return problems


# --- The payload ------------------------------------------------------------------


def run_summary(db: Session, run: Run, survey: SurveyConfig | None = None) -> dict[str, Any]:
    survey = (
        survey or db.query(SurveyConfig).filter(SurveyConfig.survey_id == run.survey_id).first()
    )
    starter = (
        db.query(User).filter(User.user_id == run.started_by_user_id).first()
        if run.started_by_user_id
        else None
    )
    stats = run.stats or {}
    counts = run_counts(db, run)
    pull = None
    if run.kind == PULL and stats:
        pull = {
            "fetched": stats.get("fetched", 0),
            "processed": stats.get("processed"),
            "new": stats.get("created", 0),
            "edited": stats.get("edited", 0),
            "flagged": stats.get("hfc_flagged", 0),
            "errors": stats.get("errors", 0),
            "duration_seconds": stats.get("duration_seconds"),
        }
    return {
        "run_id": str(run.run_id),
        "survey_id": str(run.survey_id),
        "survey_name": survey.survey_name if survey else None,
        "kind": run.kind,
        "status": run.status,
        "stage": run.stage,
        "started_by": {
            "user_id": str(starter.user_id) if starter else None,
            "name": user_name(starter),
        },
        "created_at": iso(run.created_at),
        "started_at": iso(run.started_at),
        "finished_at": iso(run.finished_at),
        "error": run.error,
        "stop_requested": bool(stats.get("stop_requested")),
        "pull": pull,
        **counts,
        "problems": run_problems(db, run, survey, counts),
    }


# --- Finishing --------------------------------------------------------------------


def _finished_text(summary: dict[str, Any]) -> tuple[str, str]:
    name = summary.get("survey_name") or "Survey"
    parts: list[str] = []
    pull = summary.get("pull")
    if pull:
        parts.append(f"{_plural(pull['new'], 'new submission')}, {pull['flagged']} flagged.")
    work: list[str] = []
    ai = summary.get("ai_checks")
    if ai and ai["queued"]:
        work.append(f"{_plural(ai['done'], 'answer')} reviewed by AI")
    transcripts = summary.get("transcripts")
    if transcripts and transcripts["queued"]:
        flagged = transcripts.get("flagged") or 0
        work.append(
            f"{_plural(transcripts['done'], 'recording')} transcribed"
            + (f" ({flagged} flagged)" if flagged else "")
        )
    translations = summary.get("translations")
    if translations and translations["queued"]:
        work.append(f"{_plural(translations['done'], 'answer')} translated")
    kobo = summary.get("kobo")
    if kobo and kobo["queued"]:
        work.append(f"{kobo['done']} sent to Kobo")
    if work:
        sentence = ", ".join(work)
        # Not str.capitalize(): it would lower-case "Kobo" and "AI".
        parts.append(sentence[0].upper() + sentence[1:] + ".")
    if summary.get("status") == "stopped":
        parts.append("Stopped before the end; the rest is picked up by the next pull.")
    title = {
        PULL: f"{name}: pull finished",
        TRANSCRIPTION_RERUN: f"{name}: transcription finished",
        TRANSLATION_RERUN: f"{name}: translation finished",
        KOBO_RESEND: f"{name}: transcripts sent to Kobo",
    }.get(summary.get("kind"), f"{name}: finished")
    return title, " ".join(parts) or "Nothing new."


def finish_if_done(db: Session, run_id: UUID | str | None) -> bool:
    """
    Mark a run finished once none of its items are queued or in progress, and
    notify whoever started it. Safe to call from every worker task: the row
    lock makes exactly one of them do it.
    """
    if not run_id:
        return False
    run_uuid = run_id if isinstance(run_id, UUID) else UUID(str(run_id))
    run = db.query(Run).filter(Run.run_id == run_uuid).with_for_update().first()
    if run is None or run.status != "background":
        db.commit()
        return False
    if has_open_items(db, run.run_id):
        db.commit()
        return False
    run.status = "stopped" if (run.stats or {}).get("stop_requested") else "finished"
    run.stage = "done"
    run.finished_at = datetime.utcnow()
    summary = run_summary(db, run)
    title, body = _finished_text(summary)
    notify(
        db,
        [run.started_by_user_id],
        kind=RUN_FINISHED,
        title=title,
        body=body
        + (" " + " ".join(p["text"] for p in summary["problems"]) if summary["problems"] else ""),
        severity="warning" if summary["problems"] else "info",
        survey_id=run.survey_id,
        run_id=run.run_id,
        link={"view": "dashboard", "survey_id": str(run.survey_id)},
    )
    db.commit()
    return True


def fail_run(db: Session, run: Run, message: str) -> None:
    run.status = "failed"
    run.stage = "done"
    run.error = message
    run.finished_at = datetime.utcnow()
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == run.survey_id).first()
    name = survey.survey_name if survey else "Survey"
    notify(
        db,
        [run.started_by_user_id],
        kind=RUN_FAILED,
        title=f"Couldn't pull {name} from Kobo",
        body=message,
        severity="warning",
        survey_id=run.survey_id,
        run_id=run.run_id,
        link={"view": "dashboard", "survey_id": str(run.survey_id)},
    )
    db.commit()


def notify_pause(
    db: Session,
    survey: SurveyConfig,
    cause: str,
    text: str,
    *,
    run_id: UUID | None = None,
    extra_user_ids: list[UUID | None] | None = None,
    link: dict | None = None,
) -> None:
    """Tell the owner (and whoever started the run) that work stopped; one per cause."""
    recipients = [survey.user_id, *(extra_user_ids or [])]
    notify(
        db,
        recipients,
        kind=PAUSED,
        title=text,
        body=None,
        severity="warning",
        survey_id=survey.survey_id,
        run_id=run_id,
        link=link
        or {"view": "settings", "survey_id": str(survey.survey_id), "tab": "transcription"},
        dedupe_key=f"pause:{survey.survey_id}:{cause}",
    )


# --- Stopping ---------------------------------------------------------------------


def stop_run(db: Session, run: Run, user: User) -> list[str]:
    """
    Stop a run's remaining work: queued AI reviews, transcriptions and translations are
    cancelled (the next pull picks them up again), unsent transcripts stay
    unsent. Items already in progress finish. A pull still fetching stops
    queueing after the submission it is on. Returns the job ids to revoke.
    """
    name = user_name(user) or "someone"
    message = f"cancelled: Stopped by {name}. It runs again on the next pull."
    update_stats(run, stop_requested=True)
    run.stopped_by_user_id = user.user_id

    job_ids: list[str] = []
    ai_rows = (
        db.query(SubmissionCurrent)
        .filter(
            SubmissionCurrent.llm_run_id == run.run_id,
            SubmissionCurrent.llm_check_status.in_(("pending", "waiting")),
        )
        .all()
    )
    for row in ai_rows:
        if row.llm_job_id:
            job_ids.append(row.llm_job_id)
        row.llm_check_status = "cancelled"
        row.llm_last_error = message
        row.llm_checked_at = datetime.utcnow()
    transcript_rows = (
        db.query(AudioTranscript)
        .filter(AudioTranscript.run_id == run.run_id, AudioTranscript.status == "pending")
        .all()
    )
    for row in transcript_rows:
        if row.job_id:
            job_ids.append(row.job_id)
        row.status = "cancelled"
        row.last_error = message
        row.finished_at = datetime.utcnow()
    db.query(AudioTranscript).filter(
        AudioTranscript.kobo_run_id == run.run_id, AudioTranscript.kobo_status == "pending"
    ).update({AudioTranscript.kobo_status: "not_sent"}, synchronize_session=False)
    translation_rows = (
        db.query(AnswerTranslation)
        .filter(
            AnswerTranslation.run_id == run.run_id,
            AnswerTranslation.status == "pending",
        )
        .all()
    )
    for row in translation_rows:
        if row.job_id:
            job_ids.append(row.job_id)
        row.status = "cancelled"
        row.last_error = message
        row.finished_at = datetime.utcnow()
    db.query(AnswerTranslation).filter(
        AnswerTranslation.kobo_run_id == run.run_id,
        AnswerTranslation.kobo_status == "pending",
    ).update({AnswerTranslation.kobo_status: "not_sent"}, synchronize_session=False)
    db.commit()
    return job_ids


def revoke(job_ids: list[str]) -> None:
    if not job_ids:
        return
    try:
        from services.job_queue import celery_app

        celery_app.control.revoke(job_ids)
    except Exception as exc:  # the cancelled status already stops them at start
        logger.warning("Could not revoke %s queued jobs: %s", len(job_ids), exc)


# --- Sweeping ---------------------------------------------------------------------


def sweep_runs(db: Session, now: datetime | None = None) -> dict[str, int]:
    """
    Fail pulls that lost their worker, finish background runs whose items all
    ended, and forget runs older than 90 days. Runs on Celery beat.
    """
    now = now or datetime.utcnow()
    swept = {"failed": 0, "finished": 0, "deleted": 0}
    stalled = (
        db.query(Run)
        .filter(
            ((Run.status == "running") & (Run.started_at < now - STALLED_PULL_RUNNING))
            | ((Run.status == "queued") & (Run.created_at < now - STALLED_PULL_QUEUED))
        )
        .all()
    )
    for run in stalled:
        fail_run(
            db,
            run,
            "The pull stopped without finishing."
            if run.status == "running"
            else "The pull never started: the background worker is not running.",
        )
        swept["failed"] += 1

    background = [run_id for (run_id,) in db.query(Run.run_id).filter(Run.status == "background")]
    for run_id in background:
        if finish_if_done(db, run_id):
            swept["finished"] += 1

    swept["deleted"] = (
        db.query(Run)
        .filter(Run.status.notin_(RUN_OPEN), Run.created_at < now - KEEP_RUNS_FOR)
        .delete(synchronize_session=False)
    )
    db.commit()
    return swept

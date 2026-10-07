"""
A pull from Kobo as a background task, recorded as a run.

The pipeline is the same one the API used to run inside the request; it now
reports its stage and counts to the run as it goes, so the page can show
progress and the result survives a reload. See
docs/specs/audio-transcription.md, section 6.1.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from services.job_queue import celery_app

logger = logging.getLogger(__name__)


def _json_stats(stats: dict[str, Any]) -> dict[str, Any]:
    """The pull's counts, without the datetimes the JSON column cannot hold."""
    return {key: value for key, value in stats.items() if not isinstance(value, datetime)}


def execute_pull(
    run_id: UUID | str, options: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """
    Run one pull for a queued run, in its own session. Returns the pipeline's
    stats, or None when the run was not runnable or failed (the run says why).
    """
    from database.models import Run, SurveyConfig, User
    from etl.kobo_fetcher import KoboFetchError, describe_kobo_error
    from etl.pipeline import ETLPipeline
    from services.auth import get_user_kobo_token
    from services.database import SessionLocal
    from services.runs import fail_run, finish_if_done

    options = options or {}
    run_uuid = run_id if isinstance(run_id, UUID) else UUID(str(run_id))
    with SessionLocal() as db:
        run = db.query(Run).filter(Run.run_id == run_uuid).first()
        if run is None or run.status != "queued":
            return None
        run.status = "running"
        run.stage = "fetching"
        run.started_at = datetime.utcnow()
        db.commit()

        user = db.query(User).filter(User.user_id == run.started_by_user_id).first()
        token = get_user_kobo_token(user) if user else None
        survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == run.survey_id).first()
        if survey is None:
            fail_run(db, run, "The survey no longer exists.")
            return None
        if user is None or not token:
            fail_run(db, run, "No Kobo API key: add one in Account settings, then pull again.")
            return None

        start_date = None
        if options.get("start_date"):
            start_date = datetime.strptime(options["start_date"], "%Y-%m-%d")
        try:
            pipeline = ETLPipeline(
                db,
                kobo_api_token=token,
                kobo_api_url=user.kobo_api_url,
                run=run,
                started_by_user_id=user.user_id,
            )
            stats = pipeline.run_pipeline(
                survey_id=str(run.survey_id),
                limit=options.get("limit"),
                start_date=start_date,
                force_validation=bool(options.get("force_validation")),
            )
        except KoboFetchError as exc:
            db.rollback()
            fail_run(db, run, describe_kobo_error(exc))
            return None
        except Exception as exc:
            logger.error("Pull %s failed: %s", run_uuid, exc, exc_info=True)
            db.rollback()
            fail_run(db, run, f"The pull failed: {exc}"[:500])
            return None

        run = db.query(Run).filter(Run.run_id == run_uuid).first()
        if run is None:  # deleted while the pull ran
            return stats
        merged = dict(run.stats or {})
        merged.update(_json_stats(stats))
        run.stats = merged
        run.status = "background"
        run.stage = "background"
        db.commit()
        finish_if_done(db, run.run_id)
        return stats


def _fail_unexpectedly(run_id: str, exc: Exception) -> None:
    """A pull that crashed outside the pipeline still ends, and says so."""
    from database.models import Run
    from services.database import SessionLocal
    from services.runs import fail_run

    with SessionLocal() as db:
        run = db.query(Run).filter(Run.run_id == UUID(str(run_id))).first()
        if run is not None and run.status in ("queued", "running"):
            fail_run(db, run, f"The pull failed: {exc}"[:500])


@celery_app.task(bind=True, name="services.pull_worker.run_pull_task", acks_late=True)
def run_pull_task(self, run_id: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        stats = execute_pull(run_id, options)
    except Exception as exc:
        logger.error("Pull %s crashed: %s", run_id, exc, exc_info=True)
        try:
            _fail_unexpectedly(run_id, exc)
        except Exception:
            logger.exception("Could not record the failure of pull %s", run_id)
        raise
    return {"run_id": run_id, "ok": stats is not None}

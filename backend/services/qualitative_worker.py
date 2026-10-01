"""Background task entrypoints for qualitative LLM checks."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import or_, text

from services.database import SessionLocal
from services.job_queue import celery_app

logger = logging.getLogger(__name__)

# Waits between attempts: 30 s, 60 s, 120 s, plus jitter so a pull's worth
# of rate-limited checks does not retry in lockstep.
_BACKOFF_BASE_SECONDS = 30
_BACKOFF_CAP_SECONDS = 300

# A check running this long has lost its worker (a call times out after 120 s
# and at most four are made). A pending one this old has lost its queue
# message: a large pull can legitimately keep checks queued for a while.
STALLED_RUNNING_AFTER = timedelta(minutes=15)
STALLED_PENDING_AFTER = timedelta(hours=6)


def _backoff_seconds(retries: int, retry_after: float | None = None) -> float:
    wait = _BACKOFF_BASE_SECONDS * (2**retries) + random.uniform(0, 10)
    if retry_after:
        wait = max(wait, retry_after)
    return min(wait, _BACKOFF_CAP_SECONDS)


@celery_app.task(
    bind=True, name="services.qualitative_worker.run_qualitative_check_task", max_retries=3
)
def run_qualitative_check_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Celery task wrapper for qualitative checks.

    The concrete processing logic is implemented in
    services.qualitative_worker_runtime.run_qualitative_check_job to keep this
    module lightweight for worker startup.
    """
    from services.ai_errors import AIError

    try:
        from services.qualitative_worker_runtime import run_qualitative_check_job

        return run_qualitative_check_job(
            payload=payload,
            job_id=self.request.id,
            final_attempt=self.request.retries >= self.max_retries,
        )
    except AIError as error:
        # Only raised while attempts remain; the runtime stored it as pending.
        raise self.retry(
            exc=error, countdown=_backoff_seconds(self.request.retries, error.retry_after)
        ) from error
    except Exception as exc:
        logger.error(
            "Qualitative check task failed (job=%s): %s", self.request.id, exc, exc_info=True
        )
        # Best-effort fallback so jobs do not remain indefinitely pending.
        try:
            submission_id = int(payload.get("submission_id"))
            survey_id = str(payload.get("survey_id"))
            with SessionLocal() as db:
                db.execute(
                    text(
                        """
                        UPDATE submissions_current
                        SET llm_check_status = 'failed',
                            llm_last_error = :error,
                            llm_checked_at = NOW()
                        WHERE survey_id = CAST(:survey_id AS UUID)
                          AND _id = :submission_id
                        """
                    ),
                    {
                        "error": f"internal: {exc}"[:1000],
                        "survey_id": survey_id,
                        "submission_id": submission_id,
                    },
                )
                db.commit()
        except Exception:
            logger.exception("Failed to persist fallback worker failure state")
        raise self.retry(exc=exc, countdown=_backoff_seconds(self.request.retries)) from exc


@celery_app.task(name="services.qualitative_worker.sweep_stalled_qualitative_checks")
def sweep_stalled_qualitative_checks() -> int:
    """
    Fail AI checks that will never finish, so none shows "in progress" forever.

    Runs on Celery beat. A swept check is re-queued on the next pull, like
    any failed one.
    """
    from database.models import SubmissionCurrent

    now = datetime.utcnow()
    with SessionLocal() as db:
        count = (
            db.query(SubmissionCurrent)
            .filter(
                or_(
                    (SubmissionCurrent.llm_check_status == "running")
                    & (SubmissionCurrent.llm_started_at < now - STALLED_RUNNING_AFTER),
                    (SubmissionCurrent.llm_check_status == "pending")
                    & (SubmissionCurrent.llm_queued_at < now - STALLED_PENDING_AFTER),
                )
            )
            .update(
                {
                    SubmissionCurrent.llm_check_status: "failed",
                    SubmissionCurrent.llm_last_error: "timeout: The AI check did not finish.",
                    SubmissionCurrent.llm_checked_at: now,
                },
                synchronize_session=False,
            )
        )
        db.commit()
    if count:
        logger.warning("Marked %s stalled AI checks as failed", count)
    return count

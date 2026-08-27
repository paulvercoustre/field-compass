"""Background task entrypoints for qualitative LLM checks."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from services.database import SessionLocal
from services.job_queue import celery_app

logger = logging.getLogger(__name__)


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
    try:
        from services.qualitative_worker_runtime import run_qualitative_check_job

        return run_qualitative_check_job(payload=payload, job_id=self.request.id)
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
                        "error": str(exc)[:1000],
                        "survey_id": survey_id,
                        "submission_id": submission_id,
                    },
                )
                db.commit()
        except Exception:
            logger.exception("Failed to persist fallback worker failure state")
        raise self.retry(exc=exc, countdown=30)

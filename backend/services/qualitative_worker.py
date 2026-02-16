"""Background task entrypoints for qualitative LLM checks."""

from __future__ import annotations

import logging
from typing import Any, Dict

from services.job_queue import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="services.qualitative_worker.run_qualitative_check_task", max_retries=3)
def run_qualitative_check_task(self, payload: Dict[str, Any]) -> Dict[str, Any]:
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
        logger.error("Qualitative check task failed (job=%s): %s", self.request.id, exc, exc_info=True)
        raise self.retry(exc=exc, countdown=30)


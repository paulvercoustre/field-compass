"""Background task entrypoint for translating one answer."""

from __future__ import annotations

import logging
from typing import Any

from services.job_queue import backoff_seconds, celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="services.translation_worker.translate_answer_task", max_retries=3)
def translate_answer_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Celery wrapper; the work is in services.translation_runtime so this
    module stays light at worker start.
    """
    from services.ai_errors import AIError

    try:
        from services.translation_runtime import run_translation_job

        return run_translation_job(
            payload=payload,
            job_id=self.request.id,
            final_attempt=self.request.retries >= self.max_retries,
        )
    except AIError as error:
        # Only raised while attempts remain; the runtime stored it as pending.
        raise self.retry(
            exc=error, countdown=backoff_seconds(self.request.retries, error.retry_after)
        ) from error

"""Background task entrypoint for translating one transcript."""

from __future__ import annotations

import logging
import random
from typing import Any

from services.job_queue import celery_app

logger = logging.getLogger(__name__)

_BACKOFF_BASE_SECONDS = 30
_BACKOFF_CAP_SECONDS = 300


def _backoff_seconds(retries: int, retry_after: float | None = None) -> float:
    wait = _BACKOFF_BASE_SECONDS * (2**retries) + random.uniform(0, 10)
    if retry_after:
        wait = max(wait, retry_after)
    return min(wait, _BACKOFF_CAP_SECONDS)


@celery_app.task(
    bind=True, name="services.translation_worker.translate_transcript_task", max_retries=3
)
def translate_transcript_task(self, payload: dict[str, Any]) -> dict[str, Any]:
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
            exc=error, countdown=_backoff_seconds(self.request.retries, error.retry_after)
        ) from error

"""Background task entrypoint for transcribing one recording."""

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
    bind=True, name="services.transcription_worker.transcribe_recording_task", max_retries=3
)
def transcribe_recording_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Celery wrapper; the work is in services.transcription_runtime so this
    module stays light at worker start.
    """
    from services.ai_errors import AIError

    try:
        from services.transcription_runtime import run_transcription_job

        return run_transcription_job(
            payload=payload,
            job_id=self.request.id,
            final_attempt=self.request.retries >= self.max_retries,
        )
    except AIError as error:
        # Only raised while attempts remain; the runtime stored it as pending.
        raise self.retry(
            exc=error, countdown=_backoff_seconds(self.request.retries, error.retry_after)
        ) from error


@celery_app.task(name="services.transcription_worker.sweep_background_work")
def sweep_background_work() -> dict[str, int]:
    """
    Fail transcriptions and pulls that lost their worker, release reservations
    left by them, and finish runs whose work has all ended. Runs on beat.
    """
    from services.database import SessionLocal
    from services.runs import sweep_runs
    from services.transcription_allowance import release_stale_reservations
    from services.transcription_runtime import sweep_stalled_transcripts

    with SessionLocal() as db:
        transcripts = sweep_stalled_transcripts(db)
        reservations = release_stale_reservations(db)
        runs = sweep_runs(db)
    if transcripts or reservations or runs.get("failed"):
        logger.warning(
            "Swept %s stalled transcriptions, %s stale reservations, runs %s",
            transcripts,
            reservations,
            runs,
        )
    return {"transcripts": transcripts, "reservations": reservations, **runs}

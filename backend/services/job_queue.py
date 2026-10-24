"""Celery application setup for asynchronous background jobs."""

import os
import random
import sys

from celery import Celery
from celery.schedules import crontab
from celery.signals import celeryd_init, worker_process_init

from settings import get_settings

# Celery puts the working directory on the import path only while it loads
# the app, then takes it off again, so a task importing a top-level backend
# package (etl, linter, forms) fails in the worker's processes. Put it back
# in each process once it has started.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@worker_process_init.connect
def _backend_on_import_path(**_):
    if _BACKEND_DIR not in sys.path:
        sys.path.insert(0, _BACKEND_DIR)


@worker_process_init.connect
def _own_database_connections(**_):
    """A forked worker process must not use the connections pooled in its parent."""
    from services.database import engine

    engine.dispose(close=False)


@celeryd_init.connect
def _report_errors(**_):
    """The worker reports its errors to Sentry, before it forks (services/monitoring.py)."""
    from services.monitoring import init_sentry

    init_sentry("worker")


# Read at import, so a malformed variable stops the worker on startup.
_settings = get_settings()
BROKER_URL = _settings.celery_broker_url
RESULT_BACKEND = _settings.result_backend

celery_app = Celery(
    "field_compass_jobs",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=[
        "services.qualitative_worker",
        "services.pull_worker",
        "services.transcription_worker",
        "services.translation_worker",
        "services.kobo_sync_worker",
        "services.retention_worker",
        "services.ai_budget_worker",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_default_queue="default",
    worker_prefetch_multiplier=1,
    task_routes={
        "services.qualitative_worker.run_qualitative_check_task": {"queue": "qualitative_checks"},
        "services.qualitative_worker.sweep_stalled_qualitative_checks": {
            "queue": "qualitative_checks"
        },
        # Pulls, transcriptions and Kobo sends on their own queues, so a long
        # recording never holds up AI reviews and the two scale separately.
        "services.pull_worker.run_pull_task": {"queue": "pulls"},
        "services.transcription_worker.transcribe_recording_task": {"queue": "transcriptions"},
        "services.transcription_worker.sweep_background_work": {"queue": "transcriptions"},
        "services.kobo_sync_worker.send_transcript_to_kobo_task": {"queue": "kobo_sync"},
        "services.kobo_sync_worker.send_translation_to_kobo_task": {"queue": "kobo_sync"},
        # A translation is an AI call, like a review: the same queue.
        "services.translation_worker.translate_answer_task": {"queue": "qualitative_checks"},
        # Housekeeping goes on a queue the worker reads; there is no "default" consumer.
        "services.retention_worker.delete_old_usage_records_task": {"queue": "transcriptions"},
        "services.ai_budget_worker.send_ai_budget_alerts_task": {"queue": "transcriptions"},
    },
    # Run by the worker's embedded beat (`-B`). The sweep is an idempotent
    # UPDATE, so a second beat from a scaled-out worker only repeats it.
    beat_schedule={
        "sweep-stalled-qualitative-checks": {
            "task": "services.qualitative_worker.sweep_stalled_qualitative_checks",
            "schedule": 300.0,
        },
        "sweep-background-work": {
            "task": "services.transcription_worker.sweep_background_work",
            "schedule": 300.0,
        },
        # Emails the usage admins at 80% and 100% of the monthly AI budget,
        # once each: a second beat finds them already sent.
        "send-ai-budget-alerts": {
            "task": "services.ai_budget_worker.send_ai_budget_alerts_task",
            "schedule": 300.0,
        },
        # After the 02:00 backup. A second beat deletes nothing more.
        "delete-old-usage-records": {
            "task": "services.retention_worker.delete_old_usage_records_task",
            "schedule": crontab(hour="3", minute="30"),
        },
    },
)

if _settings.celery_task_always_eager:
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True

# Keep autodiscovery for future conventional task modules.
celery_app.autodiscover_tasks(["services"])


# Waits between a task's attempts: 30 s, 60 s, 120 s, plus jitter so a pull's
# worth of rate-limited calls does not retry in lockstep. A provider's own
# Retry-After wins when it asks for longer; nothing waits beyond five minutes.
_BACKOFF_BASE_SECONDS = 30
_BACKOFF_CAP_SECONDS = 300


def backoff_seconds(retries: int, retry_after: float | None = None) -> float:
    """How long a task waits before its next attempt."""
    wait = _BACKOFF_BASE_SECONDS * (2**retries) + random.uniform(0, 10)
    if retry_after:
        wait = max(wait, retry_after)
    return min(wait, _BACKOFF_CAP_SECONDS)

"""Celery application setup for asynchronous background jobs."""

import os
import sys

from celery import Celery
from celery.signals import worker_process_init

# Celery puts the working directory on the import path only while it loads
# the app, then takes it off again, so a task importing a top-level backend
# package (etl, linter, forms) fails in the worker's processes. Put it back
# in each process once it has started.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@worker_process_init.connect
def _backend_on_import_path(**_):
    if _BACKEND_DIR not in sys.path:
        sys.path.insert(0, _BACKEND_DIR)


BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", BROKER_URL)

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
        # A translation is an AI call, like a review: same queue and provider.
        "services.translation_worker.translate_transcript_task": {"queue": "qualitative_checks"},
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
    },
)

if os.getenv("CELERY_TASK_ALWAYS_EAGER", "false").lower() in {"1", "true", "yes"}:
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True

# Keep autodiscovery for future conventional task modules.
celery_app.autodiscover_tasks(["services"])

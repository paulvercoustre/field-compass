"""Celery application setup for asynchronous background jobs."""

import os

from celery import Celery

BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", BROKER_URL)

celery_app = Celery(
    "field_compass_jobs",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=["services.qualitative_worker"],
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
    },
)

if os.getenv("CELERY_TASK_ALWAYS_EAGER", "false").lower() in {"1", "true", "yes"}:
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True

# Keep autodiscovery for future conventional task modules.
celery_app.autodiscover_tasks(["services"])

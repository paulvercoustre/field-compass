"""Emailing the usage admins about the monthly AI budget (services/ai_budget.py), on beat."""

from __future__ import annotations

from services import ai_budget
from services.database import SessionLocal
from services.job_queue import celery_app


@celery_app.task(name="services.ai_budget_worker.send_ai_budget_alerts_task")
def send_ai_budget_alerts_task() -> float | None:
    """Every five minutes; nothing is sent twice for the same month and share."""
    with SessionLocal() as db:
        return ai_budget.send_alerts(db)

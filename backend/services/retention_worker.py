"""
Deleting what Field Compass keeps only for a while.

Usage records -- sign-ups, sign-ins, days active, surveys created, deleted
and shared, staff access to surveys, AI use -- are kept for
USAGE_RETENTION_MONTHS (24 unless set), as the privacy notice says, and
deleted by a nightly task on Celery beat.
"""

from __future__ import annotations

import calendar
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from database.models import AIUsage, AppEvent
from services.database import SessionLocal
from services.job_queue import celery_app
from settings import get_settings

logger = logging.getLogger(__name__)


def months_before(moment: datetime, months: int) -> datetime:
    """The same day and time ``months`` earlier, or that month's last day."""
    years, month_index = divmod(moment.month - 1 - months, 12)
    year, month = moment.year + years, month_index + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def delete_old_usage_records(
    db: Session, now: datetime | None = None, months: int | None = None
) -> tuple[int, int]:
    """
    Delete usage records older than the retention period, and commit.

    Returns the number of app events and of AI usage rows deleted.
    """
    months = months or get_settings().usage_retention_months
    cutoff = months_before(now or datetime.utcnow(), months)
    events = (
        db.query(AppEvent).filter(AppEvent.created_at < cutoff).delete(synchronize_session=False)
    )
    usage = db.query(AIUsage).filter(AIUsage.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
    return events, usage


@celery_app.task(name="services.retention_worker.delete_old_usage_records_task")
def delete_old_usage_records_task() -> dict[str, int]:
    """Run nightly on beat; deleting nothing the second time is not an error."""
    with SessionLocal() as db:
        events, usage = delete_old_usage_records(db)
    if events or usage:
        logger.info("Deleted %s usage events and %s AI usage rows past retention", events, usage)
    return {"app_events": events, "ai_usage": usage}

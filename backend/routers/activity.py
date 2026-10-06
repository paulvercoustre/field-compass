"""
Background work people can see: runs (a pull and what it started), and
in-app notifications. See docs/specs/audio-transcription.md, section 6.4.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.models import RUN_OPEN, Notification, Run, User
from services.auth import CurrentUser
from services.database import DbSession
from services.notifications import notification_payload
from services.permissions import (
    AccessLevel,
    ViewableSurvey,
    get_accessible_surveys,
    get_user_permission,
    parse_uuid,
    require_survey_access,
)
from services.runs import finish_if_done, revoke, run_summary, stop_run

logger = logging.getLogger(__name__)

router = APIRouter()

# Finished runs stay in the activity indicator for this long, so the person
# who started one sees it end.
RECENTLY_FINISHED = timedelta(minutes=10)


@router.get("/activity")
async def get_activity(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Runs under way on the caller's surveys, plus those finished in the last
    ten minutes, and the caller's unread notification count. Polled by the
    app: every few seconds while something runs, every minute otherwise.
    """
    surveys = {survey.survey_id: survey for survey in get_accessible_surveys(db, current_user)}
    runs: list[Run] = []
    if surveys:
        runs = (
            db.query(Run)
            .filter(
                Run.survey_id.in_(list(surveys)),
                or_(
                    Run.status.in_(RUN_OPEN),
                    Run.finished_at >= datetime.utcnow() - RECENTLY_FINISHED,
                ),
            )
            .order_by(Run.created_at.desc())
            .limit(20)
            .all()
        )
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.user_id, Notification.read_at.is_(None))
        .count()
    )
    return {
        "runs": [run_summary(db, run, surveys.get(run.survey_id)) for run in runs],
        "active": any(run.status in RUN_OPEN for run in runs),
        "unread_notifications": unread,
    }


def _run_for(db: Session, run_id: str, user: User, min_level: AccessLevel = "viewer") -> Run:
    run = db.query(Run).filter(Run.run_id == parse_uuid(run_id, "run_id")).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    require_survey_access(db, user, run.survey_id, min_level=min_level)
    return run


@router.get("/runs/{run_id}")
async def get_run(
    run_id: str,
    db: DbSession,
    current_user: CurrentUser,
):
    return run_summary(db, _run_for(db, run_id, current_user))


@router.get("/surveys/{survey_id}/runs")
async def get_survey_runs(
    survey: ViewableSurvey,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """A survey's recent runs, newest first: its activity history."""
    runs = (
        db.query(Run)
        .filter(Run.survey_id == survey.survey_id)
        .order_by(Run.created_at.desc())
        .limit(limit)
        .all()
    )
    return {"runs": [run_summary(db, run, survey) for run in runs]}


@router.post("/runs/{run_id}/stop")
async def stop_run_endpoint(
    run_id: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Stop a run's remaining work. Whoever started it, or the survey's owner.
    Work already in progress finishes; the rest runs again on the next pull.
    """
    run = _run_for(db, run_id, current_user)
    permission = get_user_permission(db, current_user, run.survey_id)
    if run.started_by_user_id != current_user.user_id and permission not in ("owner", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Only the person who started this run, or the survey owner, can stop it.",
        )
    if run.status not in RUN_OPEN:
        return run_summary(db, run)
    job_ids = stop_run(db, run, current_user)
    revoke(job_ids)
    finish_if_done(db, run.run_id)
    db.refresh(run)
    return run_summary(db, run)


@router.get("/notifications")
async def get_notifications(
    db: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    """The caller's latest notifications, newest first, and how many are unread."""
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.user_id)
        .order_by(Notification.updated_at.desc(), Notification.notification_id.desc())
        .limit(limit)
        .all()
    )
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.user_id, Notification.read_at.is_(None))
        .count()
    )
    return {"notifications": [notification_payload(row) for row in rows], "unread": unread}


class MarkRead(BaseModel):
    ids: list[int] | None = None  # omitted: all


@router.post("/notifications/read")
async def mark_notifications_read(
    body: MarkRead,
    db: DbSession,
    current_user: CurrentUser,
):
    query = db.query(Notification).filter(
        Notification.user_id == current_user.user_id, Notification.read_at.is_(None)
    )
    if body.ids is not None:
        query = query.filter(Notification.notification_id.in_(body.ids))
    count = query.update({Notification.read_at: datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"marked": count}

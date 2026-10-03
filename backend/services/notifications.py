"""
In-app notifications: a run finished or failed, or work paused for a reason
someone must fix. Not one per submission.

See docs/specs/audio-transcription.md, section 6.5.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import Notification

RUN_FINISHED = "run_finished"
RUN_FAILED = "run_failed"
PAUSED = "paused"


def notify(
    db: Session,
    user_ids: Iterable[UUID | None],
    *,
    kind: str,
    title: str,
    body: str | None = None,
    severity: str = "info",
    survey_id: UUID | None = None,
    run_id: UUID | None = None,
    link: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> None:
    """
    Add a notification for each user. With ``dedupe_key``, an unread one with
    the same key is brought up to date instead, so a pause repeated on every
    pull stays one notification. Does not commit.
    """
    now = datetime.utcnow()
    for user_id in {uid for uid in user_ids if uid is not None}:
        existing = None
        if dedupe_key:
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_id,
                    Notification.dedupe_key == dedupe_key,
                    Notification.read_at.is_(None),
                )
                .first()
            )
        if existing is not None:
            existing.title = title[:255]
            existing.body = body
            existing.severity = severity
            existing.run_id = run_id or existing.run_id
            existing.link = link
            existing.updated_at = now
            continue
        db.add(
            Notification(
                user_id=user_id,
                survey_id=survey_id,
                run_id=run_id,
                kind=kind,
                severity=severity,
                title=title[:255],
                body=body,
                link=link,
                dedupe_key=dedupe_key,
                created_at=now,
                updated_at=now,
            )
        )


def notification_payload(notification: Notification) -> dict[str, Any]:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "notification_id": notification.notification_id,
        "survey_id": str(notification.survey_id) if notification.survey_id else None,
        "run_id": str(notification.run_id) if notification.run_id else None,
        "kind": notification.kind,
        "severity": notification.severity,
        "title": notification.title,
        "body": notification.body,
        "link": notification.link,
        "created_at": iso(notification.updated_at or notification.created_at),
        "read": notification.read_at is not None,
    }

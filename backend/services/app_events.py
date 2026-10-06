"""
What people do in the app, recorded for the admin usage figures
(routers/admin.py). Each helper adds a row to the caller's session; the
caller's own commit saves it, so an event is never recorded for something
that was rolled back.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AppEvent, User
from settings import get_settings

logger = logging.getLogger(__name__)

SIGNUP = "signup"
LOGIN = "login"
ACTIVE_DAY = "active_day"  # first authenticated request of a (UTC) day
KOBO_CONNECTED = "kobo_connected"
SURVEY_CREATED = "survey_created"
SURVEY_DELETED = "survey_deleted"
SURVEY_SHARED = "survey_shared"
ACCOUNT_DELETED = "account_deleted"

# The campaign tags the marketing site forwards to the signup form. Anything
# else in the payload is dropped, and values are cut short, so a crafted
# request cannot store arbitrary data.
SIGNUP_SOURCE_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "ref")
SIGNUP_SOURCE_MAX_LENGTH = 100


def can_view_usage(user: User) -> bool:
    """
    Whether this person sees the usage figures: their email is listed in
    USAGE_ADMIN_EMAILS (comma-separated). Deliberately separate from
    is_admin, which also opens every survey on the instance.
    """
    return bool(user.email) and user.email.strip().lower() in get_settings().usage_admins


def record(
    db: Session,
    kind: str,
    user: User | None = None,
    survey_id: UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AppEvent(
            kind=kind,
            user_id=user.user_id if user is not None else None,
            survey_id=survey_id,
            details=details or None,
        )
    )


def clean_signup_source(source: dict[str, Any] | None) -> dict[str, str] | None:
    if not source:
        return None
    cleaned = {
        key: str(source[key]).strip()[:SIGNUP_SOURCE_MAX_LENGTH]
        for key in SIGNUP_SOURCE_KEYS
        if source.get(key) and str(source[key]).strip()
    }
    return cleaned or None


def mark_active(db: Session, user: User) -> None:
    """
    Record the first authenticated request of each day as an active day.

    Called on every authenticated request, so the common case -- already
    seen today -- is decided from the loaded user row with no query. A
    failure here must never fail the request it rides on.
    """
    now = datetime.utcnow()
    last_seen = user.last_seen_at
    if last_seen is not None and last_seen.tzinfo is not None:
        # Postgres hands back timestamptz in the session's zone
        last_seen = last_seen.astimezone(UTC).replace(tzinfo=None)
    if last_seen is not None and last_seen.date() == now.date():
        return
    try:
        user.last_seen_at = now
        record(db, ACTIVE_DAY, user=user)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record an active day for user %s", user.user_id)

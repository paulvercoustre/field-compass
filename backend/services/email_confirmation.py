"""
What waits for an account's address to be confirmed: inviting people
(routers/surveys.py) and the AI features, here.

AI runs for the person who asks (reviews re-run, translations, transcripts,
rule writing, testing a key) and, during a pull, on the survey owner's
account. Both must have confirmed their address. Someone asking is refused
with a message; work a pull would queue on an unconfirmed owner's survey is
marked failed with UNCONFIRMED_OWNER, its hashes kept, so it runs on the
first pull after they confirm -- as when the survey's own key is paused.

Only where the server sends email: without it nobody can confirm, and
nothing waits.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import SurveyConfig, User
from settings import get_settings

AI_NEEDS_CONFIRMED_EMAIL = "Confirm your email address to use AI features."

# Stored as "<category>: <message>", like the AI errors (services/ai_errors.py).
UNCONFIRMED_OWNER = (
    "unconfirmed: AI features start once the survey owner confirms their email address."
)


def unconfirmed(user: User | None) -> bool:
    return user is not None and user.email_verified_at is None and get_settings().email_enabled


def require_confirmed_for_ai(user: User) -> None:
    if unconfirmed(user):
        raise HTTPException(status_code=403, detail=AI_NEEDS_CONFIRMED_EMAIL)


def unconfirmed_owner_error(db: Session, survey: SurveyConfig) -> str | None:
    """UNCONFIRMED_OWNER while the survey's owner hasn't confirmed their address."""
    if survey.user_id is None:
        return None
    return UNCONFIRMED_OWNER if unconfirmed(db.get(User, survey.user_id)) else None

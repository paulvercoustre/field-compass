"""
Surveys shared with an address that has no confirmed account yet.

Sharing gives access at once only to an account whose address is confirmed.
Anyone else -- no account yet, or an account whose address was never
confirmed -- is sent an invitation. Its link, followed while signed in with
that address, gives the access. Confirming the address any other way (the
confirmation link, a password reset) accepts every invitation waiting for it.

Without email (settings.email_enabled false) there are no invitations, and
sharing works as it always did: with existing accounts, at once.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import SurveyAccess, SurveyConfig, SurveyInvitation, User
from services import app_events
from services.email_tokens import hash_token, naive_utc, new_token

INVITATION_LIFETIME = timedelta(days=14)
# Accepted and expired invitations are deleted this long after.
KEEP_FINISHED = timedelta(days=30)

_LEVELS = {"viewer": 1, "editor": 2}


def normalise_email(email: str) -> str:
    return email.strip().lower()


def invite(
    db: Session,
    survey: SurveyConfig,
    email: str,
    permission_level: str,
    inviter: User,
) -> tuple[SurveyInvitation, str]:
    """
    Invite ``email`` to the survey, or invite them again with a new link and
    level, in the caller's transaction. Returns the invitation and the token
    for its link.
    """
    email = normalise_email(email)
    invitation = (
        db.query(SurveyInvitation)
        .filter(SurveyInvitation.survey_id == survey.survey_id, SurveyInvitation.email == email)
        .first()
    )
    if invitation is None:
        invitation = SurveyInvitation(survey_id=survey.survey_id, email=email)
        db.add(invitation)
    invitation.permission_level = permission_level
    invitation.invited_by = inviter.user_id
    invitation.accepted_at = None
    invitation.accepted_by = None
    token = new_link(invitation)
    db.flush()
    return invitation, token


def new_link(invitation: SurveyInvitation) -> str:
    """A fresh token and lifetime for the invitation; the old link stops working."""
    raw, digest = new_token()
    now = datetime.utcnow()
    invitation.token_hash = digest
    invitation.sent_at = now
    invitation.expires_at = now + INVITATION_LIFETIME
    return raw


def find(db: Session, token: str) -> SurveyInvitation | None:
    """The invitation a link is for, in whatever state it is."""
    if not token:
        return None
    return (
        db.query(SurveyInvitation).filter(SurveyInvitation.token_hash == hash_token(token)).first()
    )


def is_expired(invitation: SurveyInvitation, now: datetime | None = None) -> bool:
    return naive_utc(invitation.expires_at) <= (now or datetime.utcnow())


def pending(db: Session, survey_id: UUID) -> list[SurveyInvitation]:
    """The survey's invitations not yet accepted, expired ones included, oldest first."""
    return (
        db.query(SurveyInvitation)
        .filter(SurveyInvitation.survey_id == survey_id, SurveyInvitation.accepted_at.is_(None))
        .order_by(SurveyInvitation.created_at)
        .all()
    )


def accept(db: Session, invitation: SurveyInvitation, user: User) -> None:
    """
    Give ``user`` the access the invitation offers, in the caller's
    transaction. The caller has checked that the invitation is open and was
    sent to the user's address -- which the link reaching them also confirms.
    """
    now = datetime.utcnow()
    survey = invitation.survey
    if survey.user_id != user.user_id:
        access = (
            db.query(SurveyAccess)
            .filter(
                SurveyAccess.survey_id == invitation.survey_id,
                SurveyAccess.user_id == user.user_id,
            )
            .first()
        )
        if access is None:
            db.add(
                SurveyAccess(
                    survey_id=invitation.survey_id,
                    user_id=user.user_id,
                    permission_level=invitation.permission_level,
                    granted_by=invitation.invited_by,
                )
            )
        elif _LEVELS.get(invitation.permission_level, 0) > _LEVELS.get(access.permission_level, 0):
            # Never less than they already had.
            access.permission_level = invitation.permission_level
    invitation.accepted_at = now
    invitation.accepted_by = user.user_id
    if user.email_verified_at is None:
        user.email_verified_at = now
    app_events.record(
        db,
        app_events.INVITE_ACCEPTED,
        user=user,
        survey_id=invitation.survey_id,
        details={"permission_level": invitation.permission_level},
    )


def accept_waiting(db: Session, user: User) -> list[SurveyInvitation]:
    """Accept every open invitation for the user's address, now confirmed; the caller commits."""
    now = datetime.utcnow()
    waiting = [
        invitation
        for invitation in db.query(SurveyInvitation).filter(
            SurveyInvitation.email == normalise_email(user.email),
            SurveyInvitation.accepted_at.is_(None),
        )
        if not is_expired(invitation, now)
    ]
    for invitation in waiting:
        accept(db, invitation, user)
    return waiting


def delete_finished(db: Session, now: datetime | None = None) -> int:
    """Delete invitations accepted or expired more than KEEP_FINISHED ago; the caller commits."""
    cutoff = (now or datetime.utcnow()) - KEEP_FINISHED
    return (
        db.query(SurveyInvitation)
        .filter((SurveyInvitation.accepted_at < cutoff) | (SurveyInvitation.expires_at < cutoff))
        .delete(synchronize_session=False)
    )

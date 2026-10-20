"""
Survey invitations, from the invited person's side: what an invitation link
offers, and accepting it (services/invitations.py). The survey's owner manages
its invitations from routers/surveys.py.
"""

import logging

from fastapi import APIRouter, HTTPException

from services import account_emails, invitations
from services.auth import CurrentUser, get_user_by_email
from services.database import DbSession

logger = logging.getLogger(__name__)

router = APIRouter()

NOT_FOUND = (
    "This invitation link no longer works: it may have been withdrawn or replaced by a newer "
    "one. Ask the person who invited you to send it again."
)


@router.get("/invitations/{token}")
async def get_invitation(token: str, db: DbSession):
    """
    What an invitation link offers, for the page it opens; no sign-in needed.
    Whether an account uses the address decides between signing in and
    creating one.
    """
    invitation = invitations.find(db, token)
    if invitation is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if invitation.accepted_at is not None:
        state = "accepted"
    elif invitations.is_expired(invitation):
        state = "expired"
    else:
        state = "open"
    return {
        "email": invitation.email,
        "survey_name": invitation.survey.survey_name,
        "invited_by": account_emails.person_name(invitation.inviter),
        "permission_level": invitation.permission_level,
        "status": state,
        "account_exists": get_user_by_email(db, invitation.email) is not None,
    }


@router.post("/invitations/{token}/accept")
async def accept_invitation(token: str, db: DbSession, current_user: CurrentUser):
    """
    Accept an invitation, signed in with the address it was sent to. Accepting
    it again, by the same account, just says where the survey is.
    """
    invitation = invitations.find(db, token)
    if invitation is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    survey = {
        "survey_id": str(invitation.survey_id),
        "survey_name": invitation.survey.survey_name,
    }
    if invitation.accepted_at is not None:
        if invitation.accepted_by == current_user.user_id:
            return survey
        raise HTTPException(status_code=410, detail="This invitation has already been accepted.")
    if invitations.is_expired(invitation):
        raise HTTPException(
            status_code=410,
            detail=(
                f"This invitation has expired. Ask "
                f"{account_emails.person_name(invitation.inviter)} to send it again."
            ),
        )
    if invitations.normalise_email(current_user.email) != invitation.email:
        raise HTTPException(
            status_code=403,
            detail=(
                f"This invitation is for {invitation.email}, but you're signed in as "
                f"{current_user.email}."
            ),
        )
    invitations.accept(db, invitation, current_user)
    db.commit()
    logger.info(f"User {current_user.user_id} accepted invitation {invitation.invitation_id}")
    return survey

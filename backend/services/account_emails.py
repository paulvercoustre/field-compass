"""
The emails Field Compass sends about accounts and sharing: the words and the
data of each. How they look, as HTML and plain text, is services/
email_layout.py.

The voice is Brevo's "Complete your registration": a heading, "Hey there,",
a short paragraph or two with the action in bold, one button, then notes on
how long the link works, what to do if it wasn't you, and the link to paste.

The logo travels inside the email (email_logo.png, a related part), so it
shows without the reader's mail client fetching anything.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

from database.models import SurveyConfig, User
from services import email_layout
from services.email_layout import Bold, Message, SurveyCard
from services.mailer import Email
from settings import get_settings

LOGO_CID = email_layout.LOGO_CID
LOGO_PNG = Path(__file__).with_name("email_logo.png").read_bytes()

ROLES = {
    "viewer": ("Viewer", "Can see the submissions and reports"),
    "editor": ("Editor", "Can pull from Kobo and review submissions"),
}


def person_name(user: User | None) -> str:
    if user is None:
        return "Someone"
    return user.full_name or user.username or "Someone"


def duration(span: timedelta) -> str:
    """'1 hour', '3 days': how long a link works, in the email's words."""
    hours = round(span.total_seconds() / 3600)
    if hours < 24:
        return "1 hour" if hours == 1 else f"{hours} hours"
    days = round(hours / 24)
    return "1 day" if days == 1 else f"{days} days"


def app_link(path: str) -> str:
    return f"{get_settings().public_app_url}{path}"


def verification_email(user: User, token: str, valid_for: timedelta) -> Email:
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        message=Message(
            subject="Complete your registration",
            preview="Confirm your email address to finish setting up your account.",
            heading="Complete your registration",
            paragraphs=(
                (
                    "Welcome to Field Compass! Please ",
                    Bold("confirm your email address"),
                    " to finish setting up your account.",
                ),
                (
                    "Confirming your email helps keep your account secure and unlocks all "
                    "features of Field Compass, such as AI checks.",
                ),
            ),
            action="Confirm my email",
            link=app_link(f"/verify-email?token={token}"),
            notes=(
                f"The link expires in {duration(valid_for)}.",
                "If you didn't create a Field Compass account with this email address, "
                "you can safely ignore this message.",
            ),
            reason="you created a Field Compass account",
        ),
    )


def password_reset_email(user: User, token: str, valid_for: timedelta) -> Email:
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        message=Message(
            subject="Reset your Field Compass password",
            preview="Choose a new password for your account.",
            heading="Reset your password",
            paragraphs=(
                (
                    "We received a request to reset the password of your Field Compass account (",
                    Bold(user.email),
                    "). Use the button below to ",
                    Bold("choose a new password"),
                    ".",
                ),
            ),
            action="Choose a new password",
            link=app_link(f"/reset-password?token={token}"),
            notes=(
                f"The link expires in {duration(valid_for)} and can only be used once.",
                "If you didn't ask to reset your password, you can safely ignore this "
                "message: your password won't change.",
            ),
            reason="a password reset was requested for your Field Compass account",
        ),
    )


def password_changed_email(user: User, when: datetime) -> Email:
    """After a reset or a change in settings: tells the owner, in case it wasn't them."""
    # Asks for a reply only where replies reach someone (EMAIL_REPLY_TO).
    reply = (
        " and reply to this email so we can help secure your account"
        if get_settings().email_reply_to
        else ""
    )
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        message=Message(
            subject="Your Field Compass password was changed",
            preview="If you made this change, there's nothing else to do.",
            heading="Your password was changed",
            paragraphs=(
                (
                    "The password of your Field Compass account (",
                    Bold(user.email),
                    f") was changed on {when.day} {when:%B %Y} at {when:%H:%M} UTC.",
                ),
                (
                    "If you made this change, there's nothing else to do. If you didn't, ",
                    Bold("reset your password now"),
                    f"{reply}.",
                ),
            ),
            action="Reset my password",
            # Opens the sign-in page on "Forgot password": nothing that signs anyone in.
            link=app_link("/#forgot"),
            reason="the password of your Field Compass account was changed",
        ),
    )


def welcome_email(user: User) -> Email:
    """Once, when the address is first confirmed: what to do first."""
    notes = (
        ("Questions or feedback? Just reply to this email: a real person reads it.",)
        if get_settings().email_reply_to
        else ()
    )
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        message=Message(
            subject="Welcome to Field Compass",
            preview="Three steps to your first data-quality check.",
            heading="You're all set",
            paragraphs=(
                (
                    "Your email address is confirmed and all features of Field Compass are "
                    "open to you, AI checks included. Here's how to run your first "
                    "data-quality check:",
                ),
            ),
            steps=(
                ("Connect KoboToolbox", "Add your Kobo server and API token in Account settings."),
                (
                    "Add a survey",
                    "Pick a Kobo project; Field Compass pulls its submissions and checks them.",
                ),
                ("Invite your team", "Share the survey with supervisors and colleagues."),
            ),
            action="Open Field Compass",
            link=app_link("/"),
            notes=notes,
            paste_link=False,
            reason="you confirmed your email address on Field Compass",
        ),
    )


def invitation_email(
    *,
    to: str,
    invitation_id: object,
    inviter: User | None,
    survey: SurveyConfig,
    permission_level: str,
    token: str,
    valid_for: timedelta,
) -> Email:
    who = person_name(inviter)
    return _email(
        to=to,
        about=f"invitation {invitation_id}",
        message=Message(
            subject=f"{who} invited you to {survey.survey_name}",
            preview="Join the survey on Field Compass.",
            heading="You're invited to a survey",
            paragraphs=(
                (
                    Bold(who),
                    " has invited you to collaborate on a survey in Field Compass, the "
                    "data-quality tool for KoboToolbox.",
                ),
            ),
            card=_survey_card(who, survey, f"Invited by {who}", permission_level),
            action="Accept invitation",
            link=app_link(f"/invite?token={token}"),
            notes=(
                f"The invitation expires in {duration(valid_for)}.",
                "New to Field Compass? You'll create your account in a minute when you accept.",
                "If you weren't expecting this invitation, you can safely ignore this message.",
            ),
            reason=f"{who} invited you to a survey on Field Compass",
        ),
    )


def shared_with_you_email(
    *, user: User, inviter: User | None, survey: SurveyConfig, permission_level: str
) -> Email:
    who = person_name(inviter)
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        message=Message(
            subject=f"{who} shared {survey.survey_name} with you",
            preview="It's now in your list of surveys.",
            heading="A survey was shared with you",
            paragraphs=(
                (
                    Bold(who),
                    " has shared a survey with you on Field Compass. It's now in your list "
                    "of surveys.",
                ),
            ),
            card=_survey_card(who, survey, f"Shared by {who}", permission_level),
            action="Open survey",
            link=app_link(f"/surveys/{survey.survey_id}/submissions"),
            reason=f"{who} shared a survey with your Field Compass account",
        ),
    )


def _survey_card(who: str, survey: SurveyConfig, by_line: str, permission_level: str) -> SurveyCard:
    role, note = ROLES.get(permission_level, ROLES["viewer"])
    return SurveyCard(
        initials=email_layout.initials(who),
        survey=survey.survey_name,
        by_line=by_line,
        role=role,
        role_note=note,
    )


def _email(*, to: str, about: str, message: Message) -> Email:
    # A survey name comes from Kobo and could hold a line break, which a
    # header cannot.
    message = replace(message, subject=" ".join(message.subject.split()))
    return Email(
        to=to,
        subject=message.subject,
        text=email_layout.text(message, to),
        html=email_layout.html(message, to),
        about=about,
        images=((LOGO_CID, LOGO_PNG),),
    )

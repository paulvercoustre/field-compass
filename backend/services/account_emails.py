"""
The emails Field Compass sends about accounts and sharing, as plain text and
HTML. Each says what happened, the one thing to do, how long the link works,
and what happens if it is ignored.
"""

from __future__ import annotations

from datetime import timedelta
from html import escape

from database.models import SurveyConfig, User
from services.mailer import Email
from settings import get_settings

ROLE_WORDS = {
    "viewer": ("a viewer", "As a viewer you can see the submissions and reports."),
    "editor": ("an editor", "As an editor you can also pull from Kobo and review submissions."),
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
        subject="Confirm your email address for Field Compass",
        paragraphs=[
            f"Hello {person_name(user)},",
            f"Please confirm that {user.email} is your address. Once it is confirmed, the "
            "people you work with can share surveys with you.",
        ],
        action="Confirm my email address",
        link=app_link(f"/verify-email?token={token}"),
        after=[
            f"The link works for {duration(valid_for)}. If you didn't create a Field Compass "
            "account, you can ignore this email.",
        ],
    )


def password_reset_email(user: User, token: str, valid_for: timedelta) -> Email:
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        subject="Reset your Field Compass password",
        paragraphs=[
            f"Hello {person_name(user)},",
            f"Someone asked to reset the password of the Field Compass account for {user.email}.",
        ],
        action="Choose a new password",
        link=app_link(f"/reset-password?token={token}"),
        after=[
            f"The link works for {duration(valid_for)}, once. If you didn't ask for this, "
            "ignore this email: your password stays as it is.",
        ],
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
    role, can = ROLE_WORDS.get(permission_level, ROLE_WORDS["viewer"])
    who = person_name(inviter)
    return _email(
        to=to,
        about=f"invitation {invitation_id}",
        subject=f"{who} invited you to {survey.survey_name} on Field Compass",
        paragraphs=[
            "Hello,",
            f"{who} invited you to the survey “{survey.survey_name}” as {role}. "
            "Field Compass checks the quality of KoboToolbox data while fieldwork is under way.",
            can,
        ],
        action="Accept the invitation",
        link=app_link(f"/invite?token={token}"),
        after=[
            f"The invitation works for {duration(valid_for)}. If you weren't expecting it, "
            "you can ignore this email.",
        ],
    )


def shared_with_you_email(
    *, user: User, inviter: User | None, survey: SurveyConfig, permission_level: str
) -> Email:
    role, can = ROLE_WORDS.get(permission_level, ROLE_WORDS["viewer"])
    who = person_name(inviter)
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        subject=f"{who} shared {survey.survey_name} with you on Field Compass",
        paragraphs=[
            f"Hello {person_name(user)},",
            f"{who} shared the survey “{survey.survey_name}” with you as {role}.",
            can,
        ],
        action="Open the survey",
        link=app_link(f"/surveys/{survey.survey_id}/submissions"),
        after=["It is also in your list of surveys whenever you sign in."],
    )


def _email(
    *,
    to: str,
    about: str,
    subject: str,
    paragraphs: list[str],
    action: str,
    link: str,
    after: list[str],
) -> Email:
    # A survey name comes from Kobo and could hold a line break, which a
    # header cannot.
    subject = " ".join(subject.split())
    text = "\n\n".join([*paragraphs, f"{action}:\n{link}", *after, "Field Compass"])
    body = "".join(f"<p style='margin:0 0 16px'>{escape(p)}</p>" for p in paragraphs)
    button = (
        f"<p style='margin:24px 0'><a href='{escape(link)}' style='display:inline-block;"
        "background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;"
        f"padding:10px 18px;border-radius:8px'>{escape(action)}</a></p>"
    )
    fallback = (
        "<p style='margin:0 0 16px;color:#6b7280;font-size:13px'>If the button doesn't work, "
        f"copy this address into your browser:<br>{escape(link)}</p>"
    )
    footer = "".join(
        f"<p style='margin:0 0 16px;color:#6b7280;font-size:13px'>{escape(p)}</p>" for p in after
    )
    html = (
        "<!doctype html><html><body style='margin:0;padding:24px;background:#f9fafb'>"
        "<div style='max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;"
        "border-radius:12px;padding:28px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;"
        f"font-size:15px;line-height:1.5;color:#111827'>{body}{button}{fallback}{footer}"
        "<p style='margin:0;color:#6b7280;font-size:13px'>Field Compass</p></div></body></html>"
    )
    return Email(to=to, subject=subject, text=text, html=html, about=about)

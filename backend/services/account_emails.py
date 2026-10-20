"""
The emails Field Compass sends about accounts and sharing, as plain text and
HTML. Each has a heading that says what it is for, a sentence or two, one
button, how long the link works, and why the person got it.

The logo travels inside the email (email_logo.png, a related part), so it
shows without the reader's mail client fetching anything.
"""

from __future__ import annotations

from datetime import timedelta
from html import escape
from pathlib import Path

from database.models import SurveyConfig, User
from services.mailer import Email
from settings import get_settings

LOGO_CID = "logo@fieldcompass.org"
LOGO_PNG = Path(__file__).with_name("email_logo.png").read_bytes()

ROLE_WORDS = {"viewer": "a viewer", "editor": "an editor"}

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"


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
        subject="Confirm your email address",
        preview="One click to finish setting up your Field Compass account.",
        heading="Confirm your email address",
        paragraphs=["Confirm this address to finish setting up your Field Compass account."],
        action="Confirm email address",
        link=app_link(f"/verify-email?token={token}"),
        expiry=f"The link expires in {duration(valid_for)}.",
        reason=(
            "You're getting this email because someone created a Field Compass account "
            "with this address. If it wasn't you, you can ignore it."
        ),
    )


def password_reset_email(user: User, token: str, valid_for: timedelta) -> Email:
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        subject="Reset your password",
        preview="Choose a new password for your Field Compass account.",
        heading="Reset your password",
        paragraphs=["We got a request to reset the password of your Field Compass account."],
        action="Choose a new password",
        link=app_link(f"/reset-password?token={token}"),
        expiry=f"The link expires in {duration(valid_for)} and works once.",
        reason="If you didn't ask for this, ignore this email: your password won't change.",
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
    role = ROLE_WORDS.get(permission_level, ROLE_WORDS["viewer"])
    who = person_name(inviter)
    return _email(
        to=to,
        about=f"invitation {invitation_id}",
        subject=f"{who} invited you to {survey.survey_name} on Field Compass",
        preview=f"Join “{survey.survey_name}” as {role}.",
        heading="You're invited to a survey",
        paragraphs=[
            f"{who} invited you to “{survey.survey_name}” as {role}.",
            "Field Compass checks KoboToolbox data for quality problems while fieldwork "
            "is under way.",
        ],
        action="Accept invitation",
        link=app_link(f"/invite?token={token}"),
        expiry=f"The invitation expires in {duration(valid_for)}.",
        reason=(
            f"You're getting this email because {who} invited this address. "
            "If you weren't expecting it, you can ignore it."
        ),
    )


def shared_with_you_email(
    *, user: User, inviter: User | None, survey: SurveyConfig, permission_level: str
) -> Email:
    role = ROLE_WORDS.get(permission_level, ROLE_WORDS["viewer"])
    who = person_name(inviter)
    return _email(
        to=user.email,
        about=f"user {user.user_id}",
        subject=f"{who} shared {survey.survey_name} with you",
        preview=f"Open “{survey.survey_name}” on Field Compass.",
        heading="A survey was shared with you",
        paragraphs=[f"{who} gave you access to “{survey.survey_name}” as {role}."],
        action="Open survey",
        link=app_link(f"/surveys/{survey.survey_id}/submissions"),
        expiry=None,
        reason=(
            f"You're getting this email because {who} shared a survey with your "
            "Field Compass account."
        ),
    )


def _email(
    *,
    to: str,
    about: str,
    subject: str,
    preview: str,
    heading: str,
    paragraphs: list[str],
    action: str,
    link: str,
    expiry: str | None,
    reason: str,
) -> Email:
    # A survey name comes from Kobo and could hold a line break, which a
    # header cannot.
    subject = " ".join(subject.split())
    signature = ["Field Compass · Data quality for KoboToolbox surveys"]
    if get_settings().email_reply_to:
        signature.append("Questions? Reply to this email.")
    text = "\n\n".join(
        [
            heading,
            *paragraphs,
            f"{action}:\n{link}",
            *([expiry] if expiry else []),
            "--\n" + "\n".join([reason, *signature]),
        ]
    )
    return Email(
        to=to,
        subject=subject,
        text=text,
        html=_html(subject, preview, heading, paragraphs, action, link, expiry, reason, signature),
        about=about,
        images=((LOGO_CID, LOGO_PNG),),
    )


def _html(
    subject: str,
    preview: str,
    heading: str,
    paragraphs: list[str],
    action: str,
    link: str,
    expiry: str | None,
    reason: str,
    signature: list[str],
) -> str:
    """Tables and inline styles: what mail clients, Outlook among them, lay out alike."""
    font = f"font-family:{FONT};"
    href = escape(link)
    body = "".join(
        f'<p style="margin:0 0 12px;text-align:center">{escape(p)}</p>' for p in paragraphs
    )
    expiry_line = (
        f'<p style="margin:0;text-align:center;font-size:13px;color:#6b7280">{escape(expiry)}</p>'
        if expiry
        else ""
    )
    footer = "".join(
        f'<p style="margin:0 0 6px">{escape(line)}</p>' for line in [reason, *signature]
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
        f"<title>{escape(subject)}</title></head>"
        '<body style="margin:0;padding:0;background:#f4f4f6">'
        # What the inbox shows after the subject, instead of the email's first words.
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0">'
        f"{escape(preview)}</div>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f4f4f6"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">'
        # The logo and the name
        '<tr><td align="center" style="padding:0 0 20px">'
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="padding:0 10px 0 0"><img src="cid:{LOGO_CID}" width="32" height="32" alt="" '
        'style="display:block;border:0"></td>'
        f'<td style="{font}font-size:17px;font-weight:700;color:#111827">Field Compass</td>'
        "</tr></table></td></tr>"
        # The card
        '<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;'
        f'padding:36px 32px;{font}font-size:15px;line-height:1.6;color:#374151">'
        f'<h1 style="margin:0 0 12px;{font}font-size:22px;line-height:1.3;font-weight:700;'
        f'color:#111827;text-align:center">{escape(heading)}</h1>'
        f"{body}"
        '<table role="presentation" cellpadding="0" cellspacing="0" align="center" '
        'style="margin:24px auto 16px"><tr><td style="border-radius:8px;background:#4f46e5">'
        f'<a href="{href}" style="display:inline-block;padding:13px 28px;{font}font-size:15px;'
        'font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">'
        f"{escape(action)}</a></td></tr></table>"
        f"{expiry_line}"
        '<p style="margin:28px 0 0;padding:20px 0 0;border-top:1px solid #f0f0f3;font-size:12px;'
        'line-height:1.5;color:#9ca3af">Button not working? Paste this link into your browser:<br>'
        f'<a href="{href}" style="color:#4f46e5;word-break:break-all">{href}</a></p>'
        "</td></tr>"
        # Why it came
        f'<tr><td align="center" style="padding:20px 24px 0;{font}font-size:12px;line-height:1.5;'
        f'color:#9ca3af">{footer}</td></tr>'
        "</table></td></tr></table></body></html>"
    )

"""
Sending email: password resets, address confirmations and survey invitations.

``send`` takes a message built by services/account_emails.py. Where it goes
depends on the settings (settings.py, Email): an SMTP server when SMTP_HOST is
set, the API's log in development, and nowhere otherwise. The features that
need email check ``email_enabled`` first and say when it is off.

Callers hand ``send`` to FastAPI's background tasks, so a slow or failing
server never holds up the request. A failure is logged, naming the account or
invitation by ID -- logs never name people by address -- and the person can
ask for the email again.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import make_msgid

from settings import get_settings

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str
    # Who it is about, for the log: "user <id>" or "invitation <id>".
    about: str
    # PNGs the HTML shows by "cid:<id>", sent inside the email: (id, bytes).
    images: tuple[tuple[str, bytes], ...] = ()


def send(email: Email) -> bool:
    """Send one email; True when it left. Never raises: a failure is logged."""
    backend = get_settings().email_backend
    if backend is None:
        logger.warning("Email about %s not sent: no SMTP server is configured", email.about)
        return False
    if backend == "console":
        # Development only, on the developer's own machine: the link is the
        # point. A warning, as the API sets up no logging and drops info.
        logger.warning(
            "Email about %s, printed instead of sent (no SMTP_HOST)\nTo: %s\nSubject: %s\n\n%s",
            email.about,
            email.to,
            email.subject,
            email.text,
        )
        return True
    try:
        _send_smtp(_mime(email))
    except (smtplib.SMTPException, OSError) as exc:
        # Not the message: an SMTP error often quotes the recipient's address.
        code = getattr(exc, "smtp_code", None)
        logger.error(
            "Email about %s failed: %s%s",
            email.about,
            type(exc).__name__,
            f" ({code})" if code else "",
        )
        return False
    logger.info("Email about %s sent", email.about)
    return True


def _mime(email: Email) -> EmailMessage:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Message-ID"] = make_msgid()
    if settings.email_reply_to:
        message["Reply-To"] = settings.email_reply_to
    message.set_content(email.text)
    message.add_alternative(email.html, subtype="html")
    html = message.get_body(("html",))
    for cid, png in email.images:
        if html is not None:
            html.add_related(
                png,
                maintype="image",
                subtype="png",
                cid=f"<{cid}>",
                disposition="inline",
                filename=f"{cid.split('@')[0]}.png",
            )
    return message


def _send_smtp(message: EmailMessage) -> None:
    settings = get_settings()
    host = (settings.smtp_host or "").strip()
    context = ssl.create_default_context()
    if settings.smtp_security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS, context=context
        )
    else:
        server = smtplib.SMTP(host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=context)
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password or "")
        server.send_message(message)

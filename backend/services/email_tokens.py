"""
The links Field Compass emails to confirm an address or to reset a password.

A token is 32 random bytes, sent once in the link and stored only as its
SHA-256, so whoever reads the table cannot use it. A link works until it
expires, and asking again replaces any still unused. A reset link works once.
A confirmation link can be opened again: mail scanners often open links
before the person does, and it only ever confirms the address it was sent to.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from database.models import EmailToken, User

VERIFY_EMAIL = "verify_email"
RESET_PASSWORD = "reset_password"

LIFETIMES = {
    VERIFY_EMAIL: timedelta(days=3),
    RESET_PASSWORD: timedelta(hours=1),
}


def new_token() -> tuple[str, str]:
    """A token for a link, and the hash that is stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def naive_utc(value: datetime) -> datetime:
    """Postgres gives back aware datetimes and SQLite naive ones; compare in naive UTC."""
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def issue(db: Session, user: User, purpose: str) -> str:
    """
    A new link for ``user``, replacing any unused one for the same purpose, in
    the caller's transaction. Returns the token to put in the link.
    """
    revoke_unused(db, user, purpose)
    raw, digest = new_token()
    db.add(
        EmailToken(
            user_id=user.user_id,
            purpose=purpose,
            token_hash=digest,
            email=user.email,
            expires_at=datetime.utcnow() + LIFETIMES[purpose],
        )
    )
    return raw


def revoke_unused(db: Session, user: User, purpose: str) -> None:
    """Make every unused link of this kind stop working, in the caller's transaction."""
    db.query(EmailToken).filter(
        EmailToken.user_id == user.user_id,
        EmailToken.purpose == purpose,
        EmailToken.used_at.is_(None),
    ).delete(synchronize_session=False)


def redeem(db: Session, raw: str, purpose: str) -> User | None:
    """
    The account a link is for, marking the link used, in the caller's
    transaction; None when the link is unknown, expired, used (reset links),
    or was sent to an address the account no longer has.
    """
    if not raw:
        return None
    token = (
        db.query(EmailToken)
        .filter(EmailToken.token_hash == hash_token(raw), EmailToken.purpose == purpose)
        .first()
    )
    now = datetime.utcnow()
    if token is None or naive_utc(token.expires_at) <= now:
        return None
    if token.used_at is not None and purpose == RESET_PASSWORD:
        return None
    user = db.query(User).filter(User.user_id == token.user_id).first()
    if user is None or user.email != token.email:
        return None
    token.used_at = token.used_at or now
    # Written now, so revoking the other unused links leaves this one alone.
    db.flush()
    return user


def delete_finished(db: Session, now: datetime | None = None) -> int:
    """Delete links used or expired more than a day ago; the caller commits."""
    cutoff = (now or datetime.utcnow()) - timedelta(days=1)
    return (
        db.query(EmailToken)
        .filter((EmailToken.expires_at < cutoff) | (EmailToken.used_at < cutoff))
        .delete(synchronize_session=False)
    )

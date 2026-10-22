"""
Signing in with Google or Microsoft: OpenID Connect, the authorization code
flow with PKCE. routers/oauth.py has the endpoints; this is the protocol and
the accounts.

1. ``begin``: the browser leaves for the provider with a random state, a
   nonce and a PKCE challenge. Their secrets ride along in a signed,
   HttpOnly cookie (``STATE_COOKIE``), so nothing is stored server-side.
2. ``complete``: the provider sends the browser back with a code. The state
   must match the cookie's; the code is exchanged, with the client secret and
   the PKCE verifier, for an ID token, whose signature (the provider's
   published keys), issuer, audience, expiry and nonce are all checked.
3. ``account_for``: the provider's stable ID for the person ("sub") finds
   their account. Failing that, an address the provider vouches for finds an
   existing account and is linked to it. An address it doesn't vouch for
   never is: anyone can put any address on a Microsoft work account, and
   linking on it would hand over the account (the "nOAuth" takeover).
4. Someone new accepts the terms first (``create_account``).

The app gets its usual bearer token without it ever being in a URL: the
callback leaves a two-minute signed cookie that the app swaps for it.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database.models import User, UserIdentity
from services import invitations
from services.auth import ALGORITHM, SECRET_KEY, TERMS_VERSION, get_user_by_email
from settings import get_settings

GOOGLE = "google"
MICROSOFT = "microsoft"

# Personal Microsoft accounts (outlook.com, hotmail.com...) all share this
# tenant; their address is the one they sign in with, so it is verified.
MICROSOFT_CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"

STATE_COOKIE = "fc_sign_in"
SIGN_UP_COOKIE = "fc_sign_up"
SIGNED_IN_COOKIE = "fc_signed_in"
COOKIE_PATH = "/api/auth/oauth"
STATE_LIFETIME = timedelta(minutes=10)
SIGN_UP_LIFETIME = timedelta(minutes=30)
SIGNED_IN_LIFETIME = timedelta(minutes=2)

HTTP_TIMEOUT_SECONDS = 10
JWKS_MAX_AGE_SECONDS = 3600


@dataclass(frozen=True)
class Provider:
    name: str
    label: str
    authorize_url: str
    token_url: str
    jwks_url: str

    @property
    def client_id(self) -> str:
        return getattr(get_settings(), f"{self.name}_client_id") or ""

    @property
    def client_secret(self) -> str:
        return getattr(get_settings(), f"{self.name}_client_secret") or ""

    @property
    def redirect_uri(self) -> str:
        return f"{get_settings().public_api_url}/api/auth/oauth/{self.name}/callback"


PROVIDERS = {
    GOOGLE: Provider(
        name=GOOGLE,
        label="Google",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        jwks_url="https://www.googleapis.com/oauth2/v3/certs",
    ),
    # "common": work and school accounts from any organisation, and personal ones.
    MICROSOFT: Provider(
        name=MICROSOFT,
        label="Microsoft",
        authorize_url="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
        jwks_url="https://login.microsoftonline.com/common/discovery/v2.0/keys",
    ),
}


@dataclass(frozen=True)
class Person:
    """Who the provider says signed in."""

    provider: str
    subject: str
    email: str | None
    # Whether the provider vouches that the address is theirs.
    email_verified: bool
    name: str | None


class SignInError(Exception):
    """Ends a sign-in; ``reason`` is what the sign-in page explains."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def provider(name: str) -> Provider | None:
    """The provider of that name, if it is set up on this server."""
    if name in get_settings().sign_in_providers:
        return PROVIDERS.get(name)
    return None


def safe_next(path: str | None) -> str:
    """Where to land after signing in: a path in the app, never another site."""
    if path and path.startswith("/") and not path.startswith("//") and "\\" not in path:
        return path
    return "/"


# --- Signed cookies ---------------------------------------------------------------


def seal(claims: dict[str, Any], lifetime: timedelta, use: str) -> str:
    """A cookie value only this server could have written, for one use, until it expires."""
    payload = {**claims, "use": use, "exp": datetime.utcnow() + lifetime}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def unseal(value: str | None, use: str) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        claims = jwt.decode(value, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    return claims if claims.get("use") == use else None


def person_from(claims: dict[str, Any]) -> Person:
    return Person(
        provider=claims["provider"],
        subject=claims["subject"],
        email=claims.get("email"),
        email_verified=bool(claims.get("email_verified")),
        name=claims.get("name"),
    )


def person_claims(person: Person) -> dict[str, Any]:
    return asdict(person)


# --- The flow ---------------------------------------------------------------------


def begin(chosen: Provider, next_path: str | None) -> tuple[str, str]:
    """The provider's sign-in page to send the browser to, and the state cookie."""
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    params = {
        "client_id": chosen.client_id,
        "response_type": "code",
        "redirect_uri": chosen.redirect_uri,
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge.decode().rstrip("="),
        "code_challenge_method": "S256",
        # Lets people with several accounts choose, instead of going straight
        # in with whichever the browser is signed in to.
        "prompt": "select_account",
    }
    cookie = seal(
        {
            "provider": chosen.name,
            "state": state,
            "nonce": nonce,
            "verifier": verifier,
            "next": safe_next(next_path),
        },
        STATE_LIFETIME,
        "state",
    )
    return str(httpx.URL(chosen.authorize_url, params=params)), cookie


async def complete(
    chosen: Provider, code: str | None, state: str | None, cookie: str | None
) -> tuple[Person, str]:
    """The person the provider sent back, and where they were going."""
    started = unseal(cookie, "state")
    # A missing or foreign state is a forged or replayed callback, or one from
    # another browser: refuse it, or someone could sign the victim in as them.
    if (
        started is None
        or started.get("provider") != chosen.name
        or not state
        or not secrets.compare_digest(str(started.get("state")), state)
    ):
        raise SignInError("expired")
    if not code:
        raise SignInError("failed")
    tokens = await _exchange_code(chosen, code, started["verifier"])
    id_token = tokens.get("id_token")
    if not isinstance(id_token, str):
        raise SignInError("failed")
    claims = await verify_id_token(chosen, id_token, started["nonce"])
    return _person(chosen, claims), started["next"]


async def _exchange_code(chosen: Provider, code: str, verifier: str) -> dict[str, Any]:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": chosen.redirect_uri,
        "client_id": chosen.client_id,
        "client_secret": chosen.client_secret,
        "code_verifier": verifier,
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(chosen.token_url, data=data)
    except httpx.HTTPError as exc:
        raise SignInError("failed") from exc
    if response.status_code != 200:
        raise SignInError("failed")
    return response.json()


_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}


async def _jwks(chosen: Provider, refresh: bool = False) -> dict[str, Any]:
    """The provider's published signing keys, kept for an hour."""
    cached = _jwks_cache.get(chosen.jwks_url)
    if cached and not refresh and time.monotonic() - cached[0] < JWKS_MAX_AGE_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(chosen.jwks_url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SignInError("failed") from exc
    keys = response.json()
    _jwks_cache[chosen.jwks_url] = (time.monotonic(), keys)
    return keys


async def verify_id_token(chosen: Provider, id_token: str, nonce: str) -> dict[str, Any]:
    """The token's claims, once its signature, audience, expiry, issuer and nonce check out."""
    try:
        kid = jwt.get_unverified_header(id_token).get("kid")
    except JWTError as exc:
        raise SignInError("failed") from exc
    keys = await _jwks(chosen)
    if kid not in {key.get("kid") for key in keys.get("keys", [])}:
        # Providers rotate their keys: fetch again before giving up.
        keys = await _jwks(chosen, refresh=True)
    try:
        claims = jwt.decode(
            id_token,
            keys,
            # Only RS256, whatever the token's header claims.
            algorithms=["RS256"],
            audience=chosen.client_id,
            options={"verify_iss": False, "verify_at_hash": False},
        )
    except JWTError as exc:
        raise SignInError("failed") from exc
    if not _issuer_ok(chosen, claims):
        raise SignInError("failed")
    if not isinstance(claims.get("nonce"), str) or not secrets.compare_digest(
        claims["nonce"], nonce
    ):
        raise SignInError("failed")
    if not claims.get("sub"):
        raise SignInError("failed")
    return claims


def _issuer_ok(chosen: Provider, claims: dict[str, Any]) -> bool:
    issuer = claims.get("iss")
    if chosen.name == GOOGLE:
        return issuer in ("https://accounts.google.com", "accounts.google.com")
    # Microsoft's "common" sign-in: each organisation issues under its own tenant.
    tenant = claims.get("tid")
    return bool(tenant) and issuer == f"https://login.microsoftonline.com/{tenant}/v2.0"


def _person(chosen: Provider, claims: dict[str, Any]) -> Person:
    if chosen.name == GOOGLE:
        email = claims.get("email")
        verified = claims.get("email_verified") is True
    else:
        email = claims.get("email") or (
            claims.get("preferred_username")
            if "@" in str(claims.get("preferred_username", ""))
            else None
        )
        # A work account's address is whatever its organisation typed in;
        # Microsoft vouches for it only through the optional xms_edov claim.
        verified = claims.get("tid") == MICROSOFT_CONSUMERS_TENANT or claims.get("xms_edov") in (
            True,
            1,
            "1",
            "true",
            "True",
        )
    return Person(
        provider=chosen.name,
        subject=str(claims["sub"]),
        email=invitations.normalise_email(email) if isinstance(email, str) and email else None,
        email_verified=bool(email) and verified,
        name=claims.get("name") if isinstance(claims.get("name"), str) else None,
    )


# --- Accounts ---------------------------------------------------------------------


def find_identity(db: Session, person: Person) -> UserIdentity | None:
    return (
        db.query(UserIdentity)
        .filter(UserIdentity.provider == person.provider, UserIdentity.subject == person.subject)
        .first()
    )


def account_for(db: Session, person: Person) -> User | None:
    """
    The account this person signs in to, linking the provider to it when the
    provider vouches for its address; None for someone new. The caller commits.
    """
    now = datetime.utcnow()
    identity = find_identity(db, person)
    if identity is not None:
        identity.last_used_at = now
        return identity.user
    existing = get_user_by_email(db, person.email) if person.email else None
    if existing is None:
        return None
    if not person.email_verified:
        raise SignInError("account_exists")
    _link(db, existing, person, now)
    if existing.email_verified_at is None:
        existing.email_verified_at = now
        invitations.accept_waiting(db, existing)
    return existing


def create_account(
    db: Session, person: Person, full_name: str | None, invite_token: str | None
) -> User:
    """
    A new account for someone who signed in with a provider and accepted the
    terms: no password, the address confirmed when the provider vouches for
    it or an invitation reached it. The caller commits.
    """
    if not person.email:
        raise SignInError("no_email")
    if find_identity(db, person) is not None or get_user_by_email(db, person.email):
        raise SignInError("account_exists")
    now = datetime.utcnow()
    user = User(
        email=person.email,
        username=unique_username(db, person.email),
        password_hash=None,
        full_name=(full_name or person.name or "").strip() or None,
        terms_accepted_at=now,
        terms_version=TERMS_VERSION,
    )
    db.add(user)
    db.flush()
    _link(db, user, person, now)
    invitation = invitations.find(db, invite_token or "")
    reached_by_invitation = (
        invitation is not None
        and invitation.accepted_at is None
        and not invitations.is_expired(invitation)
        and invitation.email == user.email
    )
    if person.email_verified or reached_by_invitation:
        user.email_verified_at = now
        invitations.accept_waiting(db, user)
    return user


def _link(db: Session, user: User, person: Person, now: datetime) -> None:
    db.add(
        UserIdentity(
            user_id=user.user_id,
            provider=person.provider,
            subject=person.subject,
            email=person.email,
            created_at=now,
            last_used_at=now,
        )
    )


def unique_username(db: Session, email: str) -> str:
    """'amina.diallo@undp.org' -> 'amina.diallo', or 'amina.diallo2' when taken."""
    base = re.sub(r"[^a-z0-9._-]", "", email.split("@")[0].lower())[:40] or "user"
    candidate, number = base, 1
    while db.query(User).filter(User.username == candidate).first() is not None:
        number += 1
        candidate = f"{base}{number}"
    return candidate

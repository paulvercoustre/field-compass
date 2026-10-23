"""
Signing in with Google or Microsoft (services/sign_in.py has the protocol).

    GET  /auth/oauth/{provider}/start      leave for the provider
    GET  /auth/oauth/{provider}/callback   back from it: signed in, or on to
                                           finishing a new account
    POST /auth/oauth/session               the app swaps the sign-in for its token
    GET  /auth/oauth/pending               a new account waiting for the terms
    POST /auth/oauth/finish                the terms accepted: the account, signed in
    DELETE /users/me/sign-in/{provider}    stop signing in with a provider

The two callbacks into the app (/signed-in, /finish-sign-up) carry nothing
but where to go next: who signed in travels in short-lived signed HttpOnly
cookies, scoped to these endpoints. A failure lands on the sign-in page with
?sign_in_error=<reason>, which it explains.
"""

import logging
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from database.models import User, UserIdentity
from services import account_emails, app_events, email_tokens, mailer, sign_in
from services.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    CurrentUser,
    Token,
    UserResponse,
    create_access_token,
    get_user_by_id,
    user_to_response,
)
from services.database import DbSession
from services.rate_limit import limiter
from settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


class FinishSignUp(BaseModel):
    accept_terms: bool = False
    full_name: str | None = None
    # Campaign tags the marketing site passed along (utm_source, ref...)
    signup_source: dict[str, str] | None = None
    # Finishing a sign-up that started from a survey invitation
    invite_token: str | None = None


def _set_cookie(response: Response, name: str, value: str, lifetime: timedelta) -> None:
    response.set_cookie(
        name,
        value,
        max_age=int(lifetime.total_seconds()),
        path=sign_in.COOKIE_PATH,
        httponly=True,
        # Lax: sent when the provider sends the browser back, not on a
        # cross-site POST.
        samesite="lax",
        secure=get_settings().public_api_url.startswith("https://"),
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path=sign_in.COOKIE_PATH)


def _to_app(path: str) -> RedirectResponse:
    return RedirectResponse(f"{get_settings().public_app_url}{path}", status_code=302)


def _failed(reason: str) -> RedirectResponse:
    response = _to_app(f"/?sign_in_error={quote(reason)}")
    _clear_cookie(response, sign_in.STATE_COOKIE)
    return response


def _token_for(user: User) -> dict:
    token = create_access_token(
        data={"sub": str(user.user_id), "email": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/auth/oauth/{provider}/start")
@limiter.limit("30/minute")
async def start(request: Request, provider: str, next: str = "/"):
    chosen = sign_in.provider(provider)
    if chosen is None:
        raise HTTPException(status_code=404, detail="This server doesn't offer that sign-in")
    url, state = sign_in.begin(chosen, next)
    response = RedirectResponse(url, status_code=302)
    _set_cookie(response, sign_in.STATE_COOKIE, state, sign_in.STATE_LIFETIME)
    return response


@router.get("/auth/oauth/{provider}/callback")
@limiter.limit("30/minute")
async def callback(
    request: Request,
    provider: str,
    db: DbSession,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    chosen = sign_in.provider(provider)
    if chosen is None:
        return _failed("failed")
    if error:
        # access_denied: they closed or refused the provider's page.
        return _failed("cancelled" if error == "access_denied" else "failed")
    try:
        person, next_path = await sign_in.complete(
            chosen, code, state, request.cookies.get(sign_in.STATE_COOKIE)
        )
        user = sign_in.account_for(db, person)
    except sign_in.SignInError as exc:
        db.rollback()
        logger.info(f"Sign-in with {provider} refused: {exc.reason}")
        return _failed(exc.reason)

    if user is None:
        if not person.email:
            return _failed("no_email")
        response = _to_app(f"/finish-sign-up?next={quote(next_path)}")
        _set_cookie(
            response,
            sign_in.SIGN_UP_COOKIE,
            sign_in.seal(sign_in.person_claims(person), sign_in.SIGN_UP_LIFETIME, "sign_up"),
            sign_in.SIGN_UP_LIFETIME,
        )
        _clear_cookie(response, sign_in.STATE_COOKIE)
        return response

    if not user.is_active:
        db.rollback()
        return _failed("disabled")
    db.commit()
    response = _to_app(f"/signed-in?next={quote(next_path)}")
    _set_cookie(
        response,
        sign_in.SIGNED_IN_COOKIE,
        sign_in.seal(
            {"user_id": str(user.user_id), "provider": chosen.name},
            sign_in.SIGNED_IN_LIFETIME,
            "signed_in",
        ),
        sign_in.SIGNED_IN_LIFETIME,
    )
    _clear_cookie(response, sign_in.STATE_COOKIE)
    return response


@router.post("/auth/oauth/session", response_model=Token)
@limiter.limit("30/minute")
async def session(request: Request, response: Response, db: DbSession):
    """The app's bearer token for a sign-in that just came back from the provider."""
    claims = sign_in.unseal(request.cookies.get(sign_in.SIGNED_IN_COOKIE), "signed_in")
    _clear_cookie(response, sign_in.SIGNED_IN_COOKIE)
    user = get_user_by_id(db, claims["user_id"]) if claims else None
    if claims is None or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This sign-in has expired. Try again.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    user.last_login_at = datetime.utcnow()
    app_events.record(db, app_events.LOGIN, user=user, details={"method": claims["provider"]})
    db.commit()
    logger.info(f"User signed in with {claims['provider']}: {user.user_id}")
    return _token_for(user)


@router.get("/auth/oauth/pending")
async def pending(request: Request):
    """Who is creating an account, for the page where they accept the terms."""
    claims = sign_in.unseal(request.cookies.get(sign_in.SIGN_UP_COOKIE), "sign_up")
    if claims is None:
        raise HTTPException(
            status_code=404, detail="This sign-up has expired. Start again from the sign-in page."
        )
    person = sign_in.person_from(claims)
    return {
        "provider": person.provider,
        "provider_label": sign_in.PROVIDERS[person.provider].label,
        "email": person.email,
        "name": person.name,
    }


@router.post("/auth/oauth/finish", response_model=Token, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def finish(
    request: Request,
    payload: FinishSignUp,
    response: Response,
    db: DbSession,
    background_tasks: BackgroundTasks,
):
    """Create the account of someone new who signed in with a provider, once they accept the terms."""
    claims = sign_in.unseal(request.cookies.get(sign_in.SIGN_UP_COOKIE), "sign_up")
    if claims is None:
        raise HTTPException(
            status_code=400, detail="This sign-up has expired. Start again from the sign-in page."
        )
    if not payload.accept_terms:
        raise HTTPException(
            status_code=400,
            detail="Accept the terms of service and the data processing agreement to create an account",
        )
    person = sign_in.person_from(claims)
    try:
        user = sign_in.create_account(db, person, payload.full_name, payload.invite_token)
    except sign_in.SignInError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"An account already uses {person.email}. Sign in with your password instead.",
        ) from None

    source = app_events.clean_signup_source(payload.signup_source) or {}
    app_events.record(
        db, app_events.SIGNUP, user=user, details={**source, "method": person.provider}
    )
    user.last_login_at = datetime.utcnow()
    app_events.record(db, app_events.LOGIN, user=user, details={"method": person.provider})
    verification = None
    if user.email_verified_at is None and get_settings().email_enabled:
        token = email_tokens.issue(db, user, email_tokens.VERIFY_EMAIL)
        verification = account_emails.verification_email(
            user, token, email_tokens.LIFETIMES[email_tokens.VERIFY_EMAIL]
        )
    db.commit()
    db.refresh(user)
    if verification is not None:
        background_tasks.add_task(mailer.send, verification)
    _clear_cookie(response, sign_in.SIGN_UP_COOKIE)
    logger.info(f"New user registered with {person.provider}: {user.user_id}")
    return _token_for(user)


@router.delete("/users/me/sign-in/{provider}", response_model=UserResponse)
async def unlink(provider: str, current_user: CurrentUser, db: DbSession):
    """Stop signing in with a provider, as long as another way in remains."""
    identities = db.query(UserIdentity).filter(UserIdentity.user_id == current_user.user_id).all()
    identity = next((i for i in identities if i.provider == provider), None)
    if identity is None:
        raise HTTPException(status_code=404, detail="Your account doesn't sign in with that")
    if current_user.password_hash is None and len(identities) == 1:
        raise HTTPException(
            status_code=400,
            detail="Set a password first: without it you couldn't sign in at all.",
        )
    db.delete(identity)
    db.commit()
    db.refresh(current_user)
    return user_to_response(current_user)

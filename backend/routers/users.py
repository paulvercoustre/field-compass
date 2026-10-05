"""
User management and authentication API endpoints.
Provides user registration, login, profile management, and Kobo API key management.
"""

import logging
from datetime import datetime, timedelta
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from database.models import User
from services import app_events
from services.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    KoboApiKeyUpdate,
    KoboConnectionUpdate,
    PasswordChange,
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdate,
    authenticate_user,
    create_access_token,
    encrypt_api_key,
    get_current_active_user,
    get_password_hash,
    get_user_by_email,
    get_user_by_username,
    get_user_kobo_token,
    user_to_response,
    verify_password,
)
from services.database import get_db
from services.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Authentication Endpoints
# =============================================================================


@router.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def register(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user account.

    After registration, users can configure their Kobo API key through the profile settings.
    """
    # Check if email already exists
    if get_user_by_email(db, user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    # Check if username already exists
    if get_user_by_username(db, user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken"
        )

    # Validate password strength
    if len(user_data.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long",
        )

    # Create new user
    user = User(
        email=user_data.email.lower().strip(),
        username=user_data.username.strip(),
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
    )

    db.add(user)
    db.flush()
    app_events.record(
        db,
        app_events.SIGNUP,
        user=user,
        details=app_events.clean_signup_source(user_data.signup_source),
    )
    db.commit()
    db.refresh(user)

    logger.info(f"New user registered: {user.email}")

    return user_to_response(user)


@router.post("/auth/login", response_model=Token)
@limiter.limit("10/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Login with email and password.

    Returns a JWT access token for authenticating subsequent requests.
    The token should be included in the Authorization header as: Bearer <token>
    """
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    app_events.record(db, app_events.LOGIN, user=user)
    db.commit()

    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.user_id), "email": user.email}, expires_delta=access_token_expires
    )

    logger.info(f"User logged in: {user.email}")

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/auth/login/json", response_model=Token)
@limiter.limit("10/minute")
async def login_json(request: Request, credentials: UserLogin, db: Session = Depends(get_db)):
    """
    Alternative login endpoint accepting JSON body.
    Useful for frontend applications that prefer JSON over form data.
    """
    email = credentials.email
    password = credentials.password
    user = authenticate_user(db, email, password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    app_events.record(db, app_events.LOGIN, user=user)
    db.commit()

    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.user_id), "email": user.email}, expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer"}


# =============================================================================
# User Profile Endpoints
# =============================================================================


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_profile(current_user: User = Depends(get_current_active_user)):
    """
    Get the current authenticated user's profile.
    """
    return user_to_response(current_user)


@router.put("/users/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Update the current user's profile.
    """
    # Check username uniqueness if being changed
    if user_update.username and user_update.username != current_user.username:
        existing = get_user_by_username(db, user_update.username)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken"
            )
        current_user.username = user_update.username.strip()

    if user_update.full_name is not None:
        current_user.full_name = user_update.full_name

    if user_update.kobo_api_url is not None:
        current_user.kobo_api_url = user_update.kobo_api_url.strip()

    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)

    return user_to_response(current_user)


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_current_user(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    Delete the current user's account.

    WARNING: This action is permanent and cannot be undone.
    All associated surveys will have their user_id set to NULL (orphaned).
    """
    logger.info(f"User account deleted: {current_user.email}")
    app_events.record(db, app_events.ACCOUNT_DELETED)
    db.delete(current_user)
    db.commit()
    return


# =============================================================================
# Kobo API Key Management Endpoints
# =============================================================================


@router.put("/users/me/kobo-api-key", response_model=UserResponse)
async def set_kobo_api_key(
    api_key_data: KoboApiKeyUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Set or update the Kobo API key for the current user.

    The API key is encrypted before storage and never exposed in API responses.
    """
    if not api_key_data.kobo_api_token or len(api_key_data.kobo_api_token.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid API token format"
        )

    # Encrypt and store the API key
    current_user.kobo_api_token_encrypted = encrypt_api_key(api_key_data.kobo_api_token.strip())
    current_user.updated_at = datetime.utcnow()
    app_events.record(db, app_events.KOBO_CONNECTED, user=current_user)
    db.commit()
    db.refresh(current_user)

    logger.info(f"Kobo API key updated for user: {current_user.email}")

    return user_to_response(current_user)


@router.delete("/users/me/kobo-api-key", response_model=UserResponse)
async def delete_kobo_api_key(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    Remove the Kobo API key for the current user.
    """
    current_user.kobo_api_token_encrypted = None
    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)

    logger.info(f"Kobo API key removed for user: {current_user.email}")

    return user_to_response(current_user)


def normalize_kobo_api_url(raw: str) -> str:
    """
    The API address for whatever server address the user gives.

    People paste what they have: the address bar of their Kobo project
    (`https://eu.kobotoolbox.org/#/forms/a...`), the bare host, or the API URL.
    Kobo serves its v2 API at the root of the host, so keep only the scheme
    and host and add `/api/v2`.
    """
    text = (raw or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Enter your Kobo server address."
        )
    if "://" not in text:
        text = f"https://{text}"
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or " " in parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That doesn't look like a server address, e.g. https://kobo.example.org",
        )
    return f"{parsed.scheme}://{parsed.netloc}/api/v2"


def verify_kobo_token(api_url: str, api_token: str) -> dict | None:
    """
    Ask Kobo whether it accepts this key, and who it belongs to.

    Raises an HTTPException a person can act on when Kobo says no or can't be
    reached. Returns the Kobo account (username, email, organization) when Kobo
    shares it, otherwise None -- the key is still good.
    """
    base_url = api_url.rstrip("/")
    host = urlparse(base_url).netloc or base_url
    headers = {"Authorization": f"Token {api_token}"}

    try:
        # /assets/?limit=0 exists on every Kobo deployment, so it is the check.
        response = requests.get(
            f"{base_url}/assets/", params={"limit": 0}, headers=headers, timeout=10
        )
    except requests.exceptions.Timeout as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"{host} took too long to answer. Try again in a moment.",
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not reach a Kobo server at {host}. Check the server address.",
        ) from exc

    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{host} didn't accept that API key. Copy it again from Kobo, and check "
                "it comes from the same server you picked."
            ),
        )
    if response.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No Kobo API found at {host}. Check the server address.",
        )
    if not response.ok:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{host} answered with an error ({response.status_code}). Try again in a moment.",
        )

    # Who the key belongs to is a courtesy; the key is valid either way.
    try:
        me = requests.get(f"{base_url}/users/me/", headers=headers, timeout=5)
        if me.status_code == 200:
            data = me.json()
            return {
                "username": data.get("username"),
                "email": data.get("email"),
                "organization": data.get("organization", ""),
            }
    except (requests.RequestException, ValueError):
        return None
    return None


@router.put("/users/me/kobo-connection")
async def set_kobo_connection(
    payload: KoboConnectionUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Connect the user's Kobo account: server and API key together.

    Both are checked against Kobo first and saved only if Kobo accepts the key,
    so a typo never replaces a connection that worked. Saving them separately
    is what let a server address sit unsaved while the key was saved against
    the default server.
    """
    api_url = normalize_kobo_api_url(payload.kobo_api_url)
    api_token = (payload.kobo_api_token or "").strip()
    if len(api_token) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That's too short to be a Kobo API key. Copy the whole key from Kobo.",
        )

    kobo_user = verify_kobo_token(api_url, api_token)

    current_user.kobo_api_url = api_url
    current_user.kobo_api_token_encrypted = encrypt_api_key(api_token)
    current_user.updated_at = datetime.utcnow()
    app_events.record(db, app_events.KOBO_CONNECTED, user=current_user, details={"server": api_url})
    db.commit()
    db.refresh(current_user)

    logger.info(f"Kobo connection saved for user: {current_user.email} ({api_url})")

    return {"user": user_to_response(current_user), "kobo_user": kobo_user}


@router.get("/users/me/kobo-api-key/test")
async def test_kobo_api_key(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    Test the current user's Kobo API key by making a test request to the Kobo API.

    Returns information about the authenticated Kobo user if the key is valid.
    """
    api_token = get_user_kobo_token(current_user)

    if not api_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Kobo API key configured. Please set your API key first.",
        )

    kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    kobo_user = verify_kobo_token(kobo_api_url, api_token)
    return {"status": "success", "message": "Kobo API key is valid", "kobo_user": kobo_user}


# =============================================================================
# Password Management
# =============================================================================


@router.put("/users/me/password")
async def change_password(
    payload: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Change the current user's password.

    Credentials are read from the JSON body, never the query string.
    """
    current_password = payload.current_password
    new_password = payload.new_password
    # Verify current password
    if not verify_password(current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )

    # Validate new password
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters long",
        )

    # Update password
    current_user.password_hash = get_password_hash(new_password)
    current_user.updated_at = datetime.utcnow()
    db.commit()

    logger.info(f"Password changed for user: {current_user.email}")

    return {"message": "Password updated successfully"}

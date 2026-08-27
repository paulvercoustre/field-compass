"""
User management and authentication API endpoints.
Provides user registration, login, profile management, and Kobo API key management.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
import logging

from services.database import get_db
from services.rate_limit import limiter
from services.auth import (
    Token,
    UserCreate,
    UserResponse,
    UserUpdate,
    KoboApiKeyUpdate,
    PasswordChange,
    UserLogin,
    get_password_hash,
    verify_password,
    create_access_token,
    authenticate_user,
    get_current_active_user,
    get_user_by_email,
    get_user_by_username,
    get_user_kobo_token,
    encrypt_api_key,
    user_to_response,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
from database.models import User

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Authentication Endpoints
# =============================================================================

@router.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def register(
    request: Request,
    user_data: UserCreate,
    db: Session = Depends(get_db)
):
    """
    Register a new user account.
    
    After registration, users can configure their Kobo API key through the profile settings.
    """
    # Check if email already exists
    if get_user_by_email(db, user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username already exists
    if get_user_by_username(db, user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Validate password strength
    if len(user_data.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long"
        )
    
    # Create new user
    user = User(
        email=user_data.email.lower().strip(),
        username=user_data.username.strip(),
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    logger.info(f"New user registered: {user.email}")
    
    return user_to_response(user)


@router.post("/auth/login", response_model=Token)
@limiter.limit("10/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled"
        )
    
    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.user_id), "email": user.email},
        expires_delta=access_token_expires
    )
    
    logger.info(f"User logged in: {user.email}")
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/auth/login/json", response_model=Token)
@limiter.limit("10/minute")
async def login_json(
    request: Request,
    credentials: UserLogin,
    db: Session = Depends(get_db)
):
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled"
        )
    
    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.user_id), "email": user.email},
        expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


# =============================================================================
# User Profile Endpoints
# =============================================================================

@router.get("/users/me", response_model=UserResponse)
async def get_current_user_profile(
    current_user: User = Depends(get_current_active_user)
):
    """
    Get the current authenticated user's profile.
    """
    return user_to_response(current_user)


@router.put("/users/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Update the current user's profile.
    """
    # Check username uniqueness if being changed
    if user_update.username and user_update.username != current_user.username:
        existing = get_user_by_username(db, user_update.username)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
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
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Delete the current user's account.
    
    WARNING: This action is permanent and cannot be undone.
    All associated surveys will have their user_id set to NULL (orphaned).
    """
    logger.info(f"User account deleted: {current_user.email}")
    db.delete(current_user)
    db.commit()
    return None


# =============================================================================
# Kobo API Key Management Endpoints
# =============================================================================

@router.put("/users/me/kobo-api-key", response_model=UserResponse)
async def set_kobo_api_key(
    api_key_data: KoboApiKeyUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Set or update the Kobo API key for the current user.
    
    The API key is encrypted before storage and never exposed in API responses.
    """
    if not api_key_data.kobo_api_token or len(api_key_data.kobo_api_token.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid API token format"
        )
    
    # Encrypt and store the API key
    current_user.kobo_api_token_encrypted = encrypt_api_key(api_key_data.kobo_api_token.strip())
    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    
    logger.info(f"Kobo API key updated for user: {current_user.email}")
    
    return user_to_response(current_user)


@router.delete("/users/me/kobo-api-key", response_model=UserResponse)
async def delete_kobo_api_key(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
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


@router.get("/users/me/kobo-api-key/test")
async def test_kobo_api_key(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Test the current user's Kobo API key by making a test request to the Kobo API.
    
    Returns information about the authenticated Kobo user if the key is valid.
    """
    api_token = get_user_kobo_token(current_user)
    
    if not api_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Kobo API key configured. Please set your API key first."
        )
    
    import requests
    
    kobo_api_url = current_user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
    
    try:
        # Use /assets/?limit=0 - a standard Kobo API v2 endpoint that validates the token
        # The /me/ endpoint may not exist on all Kobo deployments
        base_url = kobo_api_url.rstrip("/")
        response = requests.get(
            f"{base_url}/assets/",
            params={"limit": 0},
            headers={"Authorization": f"Token {api_token}"},
            timeout=10
        )
        
        if response.status_code == 401:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Kobo API key. Please check your token and try again."
            )
        
        response.raise_for_status()
        
        # Try to get user info from /users/me/ if available (optional, for richer response)
        kobo_user = None
        try:
            me_response = requests.get(
                f"{base_url}/users/me/",
                headers={"Authorization": f"Token {api_token}"},
                timeout=5
            )
            if me_response.status_code == 200:
                me_data = me_response.json()
                kobo_user = {
                    "username": me_data.get("username"),
                    "email": me_data.get("email"),
                    "organization": me_data.get("organization", ""),
                }
        except Exception:
            pass  # User info is optional; token validity is confirmed by assets call
        
        return {
            "status": "success",
            "message": "Kobo API key is valid",
            "kobo_user": kobo_user
        }
        
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to Kobo API at {kobo_api_url}"
        )
    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Kobo API request timed out"
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error testing Kobo API key: {str(e)}"
        )


# =============================================================================
# Password Management
# =============================================================================

@router.put("/users/me/password")
async def change_password(
    payload: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    # Validate new password
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters long"
        )
    
    # Update password
    current_user.password_hash = get_password_hash(new_password)
    current_user.updated_at = datetime.utcnow()
    db.commit()
    
    logger.info(f"Password changed for user: {current_user.email}")
    
    return {"message": "Password updated successfully"}


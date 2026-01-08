"""
Authentication and encryption services.
Handles JWT tokens, password hashing, and Kobo API key encryption.
"""

import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel
import base64
import hashlib

from services.database import get_db
from database.models import User

load_dotenv()

# =============================================================================
# Configuration from environment
# =============================================================================

# JWT Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-secret-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))  # Default: 24 hours

# Encryption key for Kobo API tokens
# In production, this should be a proper 32-byte Fernet key
_ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if _ENCRYPTION_KEY:
    # Use provided key directly (must be valid Fernet key)
    FERNET_KEY = _ENCRYPTION_KEY.encode() if isinstance(_ENCRYPTION_KEY, str) else _ENCRYPTION_KEY
else:
    # Derive a key from JWT_SECRET_KEY for development
    # This ensures consistent encryption even if no ENCRYPTION_KEY is set
    key_bytes = hashlib.sha256(SECRET_KEY.encode()).digest()
    FERNET_KEY = base64.urlsafe_b64encode(key_bytes)

# =============================================================================
# Security instances
# =============================================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
fernet = Fernet(FERNET_KEY)


# =============================================================================
# Pydantic models for auth
# =============================================================================

class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None


class UserCreate(BaseModel):
    email: str
    username: str
    password: str
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    user_id: str
    email: str
    username: str
    full_name: Optional[str]
    has_kobo_api_key: bool
    kobo_api_url: str
    is_active: bool
    is_admin: bool
    created_at: datetime
    last_login_at: Optional[datetime]

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    kobo_api_url: Optional[str] = None


class KoboApiKeyUpdate(BaseModel):
    kobo_api_token: str


# =============================================================================
# Password hashing functions
# =============================================================================

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password for storing."""
    return pwd_context.hash(password)


# =============================================================================
# API Key encryption functions
# =============================================================================

def encrypt_api_key(api_key: str) -> str:
    """Encrypt a Kobo API key for storage."""
    return fernet.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt a stored Kobo API key."""
    return fernet.decrypt(encrypted_key.encode()).decode()


# =============================================================================
# JWT functions
# =============================================================================

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[TokenData]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        email: str = payload.get("email")
        if user_id is None:
            return None
        return TokenData(user_id=user_id, email=email)
    except JWTError:
        return None


# =============================================================================
# User authentication functions
# =============================================================================

def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    """Authenticate a user by email and password."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def get_user_by_id(db: Session, user_id: str) -> Optional[User]:
    """Get a user by their ID."""
    from uuid import UUID
    try:
        user_uuid = UUID(user_id)
        return db.query(User).filter(User.user_id == user_uuid).first()
    except ValueError:
        return None


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get a user by their email."""
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get a user by their username."""
    return db.query(User).filter(User.username == username).first()


# =============================================================================
# FastAPI dependencies
# =============================================================================

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    FastAPI dependency to get the current authenticated user.
    Raises 401 if token is invalid or user not found.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token_data = decode_access_token(token)
    if token_data is None:
        raise credentials_exception
    
    user = get_user_by_id(db, token_data.user_id)
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    FastAPI dependency to get the current active user.
    Raises 400 if user is inactive.
    """
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


async def get_optional_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """
    FastAPI dependency to optionally get the current user.
    Returns None if no valid token is provided (instead of raising an error).
    Useful for endpoints that work with or without authentication.
    """
    if not token:
        return None
    
    token_data = decode_access_token(token)
    if token_data is None:
        return None
    
    return get_user_by_id(db, token_data.user_id)


# =============================================================================
# Kobo API key helpers
# =============================================================================

def get_user_kobo_token(user: User) -> Optional[str]:
    """
    Get the decrypted Kobo API token for a user.
    Returns None if user has no token configured.
    """
    if not user.kobo_api_token_encrypted:
        return None
    try:
        return decrypt_api_key(user.kobo_api_token_encrypted)
    except Exception:
        return None


def set_user_kobo_token(db: Session, user: User, api_token: str) -> None:
    """Set the Kobo API token for a user (encrypts before storing)."""
    user.kobo_api_token_encrypted = encrypt_api_key(api_token)
    db.commit()


def user_to_response(user: User) -> dict:
    """Convert a User model to a UserResponse dictionary."""
    return {
        "user_id": str(user.user_id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "has_kobo_api_key": bool(user.kobo_api_token_encrypted),
        "kobo_api_url": user.kobo_api_url or "https://kf.kobotoolbox.org/api/v2",
        "is_active": user.is_active,
        "is_admin": user.is_admin,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


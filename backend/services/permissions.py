"""
Permission checking service for survey access control.
Handles user-to-survey permissions including ownership and shared access.
"""

from collections.abc import Callable
from typing import Literal, cast
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.models import SurveyAccess, SurveyConfig, User
from services.auth import get_current_active_user
from services.database import get_db

# Permission level type
PermissionLevel = Literal["owner", "editor", "viewer", "admin"]
# What an endpoint can require; an admin satisfies all of them.
AccessLevel = Literal["viewer", "editor", "owner"]


def get_user_permission(db: Session, user: User, survey_id: UUID) -> PermissionLevel | None:
    """
    Get the user's permission level for a specific survey.

    Returns:
        'admin' - if user is system admin
        'owner' - if user owns the survey
        'editor' - if user has editor access
        'viewer' - if user has viewer access
        None - if user has no access
    """
    # System admins have full access to everything
    if user.is_admin:
        return "admin"

    # Check if user owns the survey
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).first()

    if not survey:
        return None

    if survey.user_id == user.user_id:
        return "owner"

    # Check shared access
    access = (
        db.query(SurveyAccess)
        .filter(SurveyAccess.survey_id == survey_id, SurveyAccess.user_id == user.user_id)
        .first()
    )

    if access:
        return cast(PermissionLevel, access.permission_level)

    return None


def get_accessible_surveys(db: Session, user: User) -> list[SurveyConfig]:
    """
    Get all surveys a user can access (owned + shared).
    Admins can see all surveys.
    """
    if user.is_admin:
        return db.query(SurveyConfig).all()

    # Get surveys user owns OR has been shared with
    return (
        db.query(SurveyConfig)
        .filter(
            or_(
                SurveyConfig.user_id == user.user_id,
                SurveyConfig.survey_id.in_(
                    db.query(SurveyAccess.survey_id).filter(SurveyAccess.user_id == user.user_id)
                ),
            )
        )
        .all()
    )


def require_survey_access(
    db: Session,
    user: User,
    survey_id: UUID,
    min_level: AccessLevel = "viewer",
) -> SurveyConfig:
    """
    Require user to have at least the specified access level to the survey.
    Raises HTTPException if access is denied.

    Returns the survey if access is granted.
    """
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).first()

    if not survey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Survey not found")

    permission = get_user_permission(db, user, survey_id)

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this survey"
        )

    # Define permission hierarchy
    permission_hierarchy = {"viewer": 1, "editor": 2, "owner": 3, "admin": 4}

    required_level = permission_hierarchy.get(min_level, 1)
    user_level = permission_hierarchy.get(permission, 0)

    if user_level < required_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires {min_level} access or higher",
        )

    return survey


def grant_survey_access(
    db: Session,
    survey_id: UUID,
    user_id: UUID,
    permission_level: Literal["editor", "viewer"],
    granted_by: UUID,
) -> SurveyAccess:
    """
    Grant a user access to a survey.
    Updates existing access if already present.
    """
    # Check if access already exists
    existing = (
        db.query(SurveyAccess)
        .filter(SurveyAccess.survey_id == survey_id, SurveyAccess.user_id == user_id)
        .first()
    )

    if existing:
        existing.permission_level = permission_level
        existing.granted_by = granted_by
        db.commit()
        db.refresh(existing)
        return existing

    # Create new access
    access = SurveyAccess(
        survey_id=survey_id,
        user_id=user_id,
        permission_level=permission_level,
        granted_by=granted_by,
    )
    db.add(access)
    db.commit()
    db.refresh(access)
    return access


def revoke_survey_access(db: Session, survey_id: UUID, user_id: UUID) -> bool:
    """
    Revoke a user's access to a survey.
    Returns True if access was revoked, False if no access existed.
    """
    result = (
        db.query(SurveyAccess)
        .filter(SurveyAccess.survey_id == survey_id, SurveyAccess.user_id == user_id)
        .delete()
    )

    db.commit()
    return result > 0


def get_survey_access_list(db: Session, survey_id: UUID) -> list[dict]:
    """
    Get list of all users with access to a survey.
    Returns owner info plus all shared access entries.
    """
    survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).first()

    if not survey:
        return []

    access_list = []

    # Add owner if exists
    if survey.owner:
        access_list.append(
            {
                "user_id": str(survey.owner.user_id),
                "email": survey.owner.email,
                "username": survey.owner.username,
                "full_name": survey.owner.full_name,
                "permission_level": "owner",
                "granted_at": survey.created_at,
            }
        )

    # Add shared access
    shared = db.query(SurveyAccess).filter(SurveyAccess.survey_id == survey_id).all()

    access_list.extend(
        {
            "user_id": str(access.user_id),
            "email": access.user.email,
            "username": access.user.username,
            "full_name": access.user.full_name,
            "permission_level": access.permission_level,
            "granted_at": access.granted_at,
            "granted_by": str(access.granted_by) if access.granted_by else None,
        }
        for access in shared
    )

    return access_list


def parse_uuid(value: str, what: str = "survey_id") -> UUID:
    """A UUID from a request, or a 400 naming which value was malformed."""
    try:
        return UUID(str(value))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {what} format: {value}. Must be a valid UUID.",
        ) from None


def survey_access(min_level: AccessLevel = "viewer") -> Callable[..., SurveyConfig]:
    """
    A dependency resolving the request's ``survey_id`` to its survey, once the
    current user is known to hold at least ``min_level`` on it.

    ``survey_id`` binds to the path when the route has ``{survey_id}`` and to
    the query string otherwise. A malformed id is a 400, an unknown survey a
    404 and too little access a 403, the same as ``require_survey_access``.

        survey: SurveyConfig = Depends(survey_access("editor"))
    """

    def dependency(
        survey_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_active_user),
    ) -> SurveyConfig:
        return require_survey_access(db, current_user, parse_uuid(survey_id), min_level)

    return dependency

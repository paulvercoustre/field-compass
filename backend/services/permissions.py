"""
Permission checking service for survey access control.
Handles user-to-survey permissions including ownership and shared access.
"""

from typing import Optional, Literal
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException, status

from database.models import User, SurveyConfig, SurveyAccess


# Permission level type
PermissionLevel = Literal['owner', 'editor', 'viewer', 'admin']


def get_user_permission(
    db: Session,
    user: User,
    survey_id: UUID
) -> Optional[PermissionLevel]:
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
        return 'admin'
    
    # Check if user owns the survey
    survey = db.query(SurveyConfig).filter(
        SurveyConfig.survey_id == survey_id
    ).first()
    
    if not survey:
        return None
    
    if survey.user_id == user.user_id:
        return 'owner'
    
    # Check shared access
    access = db.query(SurveyAccess).filter(
        SurveyAccess.survey_id == survey_id,
        SurveyAccess.user_id == user.user_id
    ).first()
    
    if access:
        return access.permission_level
    
    return None


def get_accessible_surveys(db: Session, user: User) -> list[SurveyConfig]:
    """
    Get all surveys a user can access (owned + shared).
    Admins can see all surveys.
    """
    if user.is_admin:
        return db.query(SurveyConfig).all()
    
    # Get surveys user owns OR has been shared with
    return db.query(SurveyConfig).filter(
        or_(
            SurveyConfig.user_id == user.user_id,
            SurveyConfig.survey_id.in_(
                db.query(SurveyAccess.survey_id).filter(
                    SurveyAccess.user_id == user.user_id
                )
            )
        )
    ).all()


def can_view_survey(db: Session, user: User, survey_id: UUID) -> bool:
    """Check if user can view a survey (any access level)."""
    permission = get_user_permission(db, user, survey_id)
    return permission is not None


def can_edit_survey(db: Session, user: User, survey_id: UUID) -> bool:
    """Check if user can edit survey data (run ETL, resolve flags)."""
    permission = get_user_permission(db, user, survey_id)
    return permission in ('owner', 'editor', 'admin')


def can_configure_survey(db: Session, user: User, survey_id: UUID) -> bool:
    """Check if user can configure survey settings (HFC rules, etc)."""
    permission = get_user_permission(db, user, survey_id)
    return permission in ('owner', 'admin')


def can_share_survey(db: Session, user: User, survey_id: UUID) -> bool:
    """Check if user can share survey with others."""
    permission = get_user_permission(db, user, survey_id)
    return permission in ('owner', 'admin')


def can_delete_survey(db: Session, user: User, survey_id: UUID) -> bool:
    """Check if user can delete the survey."""
    permission = get_user_permission(db, user, survey_id)
    return permission in ('owner', 'admin')


def require_survey_access(
    db: Session,
    user: User,
    survey_id: UUID,
    min_level: Literal['viewer', 'editor', 'owner'] = 'viewer'
) -> SurveyConfig:
    """
    Require user to have at least the specified access level to the survey.
    Raises HTTPException if access is denied.
    
    Returns the survey if access is granted.
    """
    survey = db.query(SurveyConfig).filter(
        SurveyConfig.survey_id == survey_id
    ).first()
    
    if not survey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Survey not found"
        )
    
    permission = get_user_permission(db, user, survey_id)
    
    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this survey"
        )
    
    # Define permission hierarchy
    permission_hierarchy = {
        'viewer': 1,
        'editor': 2,
        'owner': 3,
        'admin': 4
    }
    
    required_level = permission_hierarchy.get(min_level, 1)
    user_level = permission_hierarchy.get(permission, 0)
    
    if user_level < required_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires {min_level} access or higher"
        )
    
    return survey


def grant_survey_access(
    db: Session,
    survey_id: UUID,
    user_id: UUID,
    permission_level: Literal['editor', 'viewer'],
    granted_by: UUID
) -> SurveyAccess:
    """
    Grant a user access to a survey.
    Updates existing access if already present.
    """
    # Check if access already exists
    existing = db.query(SurveyAccess).filter(
        SurveyAccess.survey_id == survey_id,
        SurveyAccess.user_id == user_id
    ).first()
    
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
        granted_by=granted_by
    )
    db.add(access)
    db.commit()
    db.refresh(access)
    return access


def revoke_survey_access(
    db: Session,
    survey_id: UUID,
    user_id: UUID
) -> bool:
    """
    Revoke a user's access to a survey.
    Returns True if access was revoked, False if no access existed.
    """
    result = db.query(SurveyAccess).filter(
        SurveyAccess.survey_id == survey_id,
        SurveyAccess.user_id == user_id
    ).delete()
    
    db.commit()
    return result > 0


def get_survey_access_list(db: Session, survey_id: UUID) -> list[dict]:
    """
    Get list of all users with access to a survey.
    Returns owner info plus all shared access entries.
    """
    survey = db.query(SurveyConfig).filter(
        SurveyConfig.survey_id == survey_id
    ).first()
    
    if not survey:
        return []
    
    access_list = []
    
    # Add owner if exists
    if survey.owner:
        access_list.append({
            'user_id': str(survey.owner.user_id),
            'email': survey.owner.email,
            'username': survey.owner.username,
            'full_name': survey.owner.full_name,
            'permission_level': 'owner',
            'granted_at': survey.created_at
        })
    
    # Add shared access
    shared = db.query(SurveyAccess).filter(
        SurveyAccess.survey_id == survey_id
    ).all()
    
    for access in shared:
        access_list.append({
            'user_id': str(access.user_id),
            'email': access.user.email,
            'username': access.user.username,
            'full_name': access.user.full_name,
            'permission_level': access.permission_level,
            'granted_at': access.granted_at,
            'granted_by': str(access.granted_by) if access.granted_by else None
        })
    
    return access_list


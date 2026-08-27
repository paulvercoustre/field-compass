"""
SQLAlchemy ORM models for database tables.
These models map to the PostgreSQL schema defined in schema.sql.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class User(Base):
    """ORM model for users table."""

    __tablename__ = "users"

    user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True, index=True)
    username = Column(String(100), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    # Kobo API credentials (encrypted at rest)
    kobo_api_token_encrypted = Column(Text, nullable=True)
    kobo_api_url = Column(String(500), default="https://kf.kobotoolbox.org/api/v2")
    # Account status
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    owned_surveys = relationship(
        "SurveyConfig", back_populates="owner", foreign_keys="SurveyConfig.user_id"
    )
    survey_access = relationship(
        "SurveyAccess", back_populates="user", foreign_keys="SurveyAccess.user_id"
    )


class SurveyConfig(Base):
    """ORM model for survey_configs table."""

    __tablename__ = "survey_configs"

    survey_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_name = Column(String(255), nullable=False, unique=True)
    kobo_asset_id = Column(String(255), nullable=True)
    config_data = Column(JSONB, nullable=False)
    # User ownership (for multi-tenancy)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="owned_surveys", foreign_keys=[user_id])
    shared_access = relationship(
        "SurveyAccess", back_populates="survey", cascade="all, delete-orphan"
    )
    validation_rules = relationship(
        "ValidationRule", back_populates="survey_config", cascade="all, delete-orphan"
    )
    submissions = relationship("SubmissionCurrent", back_populates="survey_config")


class ValidationRule(Base):
    """ORM model for validation_rules table."""

    __tablename__ = "validation_rules"

    rule_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_name = Column(String(255), nullable=False)
    rule_data = Column(JSONB, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    survey_config = relationship("SurveyConfig", back_populates="validation_rules")

    __table_args__ = ({"comment": "High-frequency check validation rules for data quality"},)


class SubmissionCurrent(Base):
    """ORM model for submissions_current table."""

    __tablename__ = "submissions_current"

    _id = Column(Integer, primary_key=True)
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="RESTRICT"),
        nullable=False,
    )
    _uuid = Column(String(255), nullable=False, unique=True)
    _submission_time = Column(DateTime(timezone=True), nullable=False)
    end = Column(
        "end", DateTime(timezone=True), nullable=False
    )  # "end" is quoted because it's a PostgreSQL reserved word
    submission_data = Column(JSONB, nullable=False)
    is_edited = Column(
        Boolean, default=False
    )  # Temporary flag: submission needs validation due to recent edit
    has_edit_history = Column(
        Boolean, default=False
    )  # Permanent flag: submission was edited at least once
    data_quality_issues = Column(JSONB, default=[])
    qa_status = Column(String(50), default="PENDING_APPROVAL")
    dk_count = Column(Integer, nullable=True)  # Number of DK answers in eligible fields
    dk_eligible_count = Column(Integer, nullable=True)  # Denominator used for DK percentage
    dk_percentage = Column(Numeric(5, 2), nullable=True)  # DK percentage for the submission
    kobo_validation_status = Column(String(50), nullable=True)  # Stores Kobo's _validation_status
    kobo_edit_url = Column(String(500), nullable=True)  # URL to view/edit in Kobo
    reviewer_notes = Column(Text, nullable=True)  # Reviewer-provided notes for this submission
    # Validation tracking fields (for incremental validation)
    last_validated_at = Column(
        DateTime(timezone=True), nullable=True
    )  # When validation checks were last run
    validation_rule_hash = Column(
        String(64), nullable=True
    )  # Hash of rule config used for validation
    # LLM qualitative check tracking fields
    llm_check_status = Column(
        String(20), nullable=False, default="skipped"
    )  # pending|running|success|failed|skipped
    llm_rules_hash = Column(String(64), nullable=True)  # Hash of qualitative rules/config used
    llm_input_hash = Column(String(64), nullable=True)  # Hash of normalized monitored field values
    llm_model_used = Column(String(128), nullable=True)  # Model used for qualitative checks
    llm_job_id = Column(String(128), nullable=True)  # Async job id for queue tracking
    llm_queued_at = Column(DateTime(timezone=True), nullable=True)  # Time job was enqueued
    llm_started_at = Column(
        DateTime(timezone=True), nullable=True
    )  # Time worker started processing
    llm_checked_at = Column(
        DateTime(timezone=True), nullable=True
    )  # Time worker completed processing
    llm_last_error = Column(Text, nullable=True)  # Last worker/API error (if any)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    survey_config = relationship("SurveyConfig", back_populates="submissions")
    history = relationship(
        "SubmissionHistory", back_populates="submission", cascade="all, delete-orphan"
    )


class SubmissionHistory(Base):
    """ORM model for submissions_history table."""

    __tablename__ = "submissions_history"

    history_id = Column(Integer, primary_key=True, autoincrement=True)
    kobo_id = Column(
        Integer, ForeignKey("submissions_current._id", ondelete="CASCADE"), nullable=False
    )
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    deprecated_uuid = Column(String(255), nullable=False)
    data_delta = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    submission = relationship("SubmissionCurrent", back_populates="history")


class SurveyAccess(Base):
    """ORM model for survey_access table - manages shared access to surveys."""

    __tablename__ = "survey_access"

    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    permission_level = Column(String(20), nullable=False)  # 'editor' or 'viewer'
    granted_by = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    granted_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    survey = relationship("SurveyConfig", back_populates="shared_access")
    user = relationship("User", back_populates="survey_access", foreign_keys=[user_id])
    granter = relationship("User", foreign_keys=[granted_by])

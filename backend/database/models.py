"""
SQLAlchemy ORM models for database tables.
These models map to the PostgreSQL schema defined in schema.sql.
"""

from datetime import datetime
from typing import Dict, Any
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
import uuid

Base = declarative_base()


class SurveyConfig(Base):
    """ORM model for survey_configs table."""
    
    __tablename__ = "survey_configs"
    
    survey_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_name = Column(String(255), nullable=False, unique=True)
    kobo_asset_id = Column(String(255), nullable=True)
    config_data = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    validation_rules = relationship("ValidationRule", back_populates="survey_config", cascade="all, delete-orphan")
    submissions = relationship("SubmissionCurrent", back_populates="survey_config")


class ValidationRule(Base):
    """ORM model for validation_rules table."""
    
    __tablename__ = "validation_rules"
    
    rule_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id = Column(UUID(as_uuid=True), ForeignKey("survey_configs.survey_id", ondelete="CASCADE"), nullable=False)
    rule_name = Column(String(255), nullable=False)
    rule_data = Column(JSONB, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    survey_config = relationship("SurveyConfig", back_populates="validation_rules")
    
    __table_args__ = (
        {"comment": "High-frequency check validation rules for data quality"},
    )


class SubmissionCurrent(Base):
    """ORM model for submissions_current table."""
    
    __tablename__ = "submissions_current"
    
    _id = Column(Integer, primary_key=True)
    survey_id = Column(UUID(as_uuid=True), ForeignKey("survey_configs.survey_id", ondelete="RESTRICT"), nullable=False)
    _uuid = Column(String(255), nullable=False, unique=True)
    _submission_time = Column(DateTime(timezone=True), nullable=False)
    end = Column("end", DateTime(timezone=True), nullable=False)  # "end" is quoted because it's a PostgreSQL reserved word
    submission_data = Column(JSONB, nullable=False)
    is_edited = Column(Boolean, default=False)
    data_quality_issues = Column(JSONB, default=[])
    qa_status = Column(String(50), default="PENDING_APPROVAL")
    kobo_validation_status = Column(String(50), nullable=True)  # Stores Kobo's _validation_status
    kobo_edit_url = Column(String(500), nullable=True)  # URL to view/edit in Kobo
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    survey_config = relationship("SurveyConfig", back_populates="submissions")
    history = relationship("SubmissionHistory", back_populates="submission", cascade="all, delete-orphan")


class SubmissionHistory(Base):
    """ORM model for submissions_history table."""
    
    __tablename__ = "submissions_history"
    
    history_id = Column(Integer, primary_key=True, autoincrement=True)
    kobo_id = Column(Integer, ForeignKey("submissions_current._id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    deprecated_uuid = Column(String(255), nullable=False)
    data_delta = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships
    submission = relationship("SubmissionCurrent", back_populates="history")


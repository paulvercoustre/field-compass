"""
SQLAlchemy ORM models for database tables.
These models map to the PostgreSQL schema defined in schema.sql.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    """ORM model for users table."""

    __tablename__ = "users"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Kobo API credentials (encrypted at rest)
    kobo_api_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    kobo_api_url: Mapped[str | None] = mapped_column(
        String(500), default="https://kf.kobotoolbox.org/api/v2"
    )
    # Account status
    is_active: Mapped[bool | None] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool | None] = mapped_column(Boolean, default=False)
    # Timestamps
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Last authenticated request; moves at most once a day (services/app_events.py)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    owned_surveys: Mapped[list["SurveyConfig"]] = relationship(
        "SurveyConfig", back_populates="owner", foreign_keys="SurveyConfig.user_id"
    )
    survey_access: Mapped[list["SurveyAccess"]] = relationship(
        "SurveyAccess", back_populates="user", foreign_keys="SurveyAccess.user_id"
    )


class SurveyConfig(Base):
    """ORM model for survey_configs table."""

    __tablename__ = "survey_configs"

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    survey_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    kobo_asset_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    config_data: Mapped[Any] = mapped_column(JSONB, nullable=False)
    # User ownership (for multi-tenancy)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    # The survey owner's own AI provider; NULL uses the operator's key.
    ai_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )
    # The owner's own ElevenLabs key for transcription; NULL uses the
    # operator's, within the included usage.
    transcription_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )
    # The owner's own AI provider for translation (an OpenAI-compatible key,
    # chosen apart from AI review's); NULL uses the operator's, within the
    # included translations.
    translation_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )

    owner: Mapped["User | None"] = relationship(
        "User", back_populates="owned_surveys", foreign_keys=[user_id]
    )
    shared_access: Mapped[list["SurveyAccess"]] = relationship(
        "SurveyAccess", back_populates="survey", cascade="all, delete-orphan"
    )
    validation_rules: Mapped[list["ValidationRule"]] = relationship(
        "ValidationRule", back_populates="survey_config", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["SubmissionCurrent"]] = relationship(
        "SubmissionCurrent", back_populates="survey_config"
    )


class ValidationRule(Base):
    """ORM model for validation_rules table."""

    __tablename__ = "validation_rules"

    rule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    rule_name: Mapped[str] = mapped_column(String(255), nullable=False)
    rule_data: Mapped[Any] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool | None] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    survey_config: Mapped["SurveyConfig"] = relationship(
        "SurveyConfig", back_populates="validation_rules"
    )

    __table_args__ = ({"comment": "High-frequency check validation rules for data quality"},)


class SubmissionCurrent(Base):
    """ORM model for submissions_current table."""

    __tablename__ = "submissions_current"

    _id: Mapped[int] = mapped_column(Integer, primary_key=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="RESTRICT"),
        nullable=False,
    )
    _uuid: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    _submission_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end: Mapped[datetime] = mapped_column(
        "end", DateTime(timezone=True), nullable=False
    )  # "end" is quoted because it's a PostgreSQL reserved word
    submission_data: Mapped[Any] = mapped_column(JSONB, nullable=False)
    is_edited: Mapped[bool | None] = mapped_column(
        Boolean, default=False
    )  # Temporary flag: submission needs validation due to recent edit
    has_edit_history: Mapped[bool | None] = mapped_column(
        Boolean, default=False
    )  # Permanent flag: submission was edited at least once
    data_quality_issues: Mapped[Any | None] = mapped_column(JSONB, default=[])
    qa_status: Mapped[str | None] = mapped_column(String(50), default="PENDING_APPROVAL")
    dk_count: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # Number of DK answers in eligible fields
    dk_eligible_count: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # Denominator used for DK percentage
    dk_percentage: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )  # DK percentage for the submission
    kobo_validation_status: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Stores Kobo's _validation_status
    kobo_edit_url: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # URL to view/edit in Kobo
    reviewer_notes: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # Reviewer-provided notes for this submission
    # Validation tracking fields (for incremental validation)
    last_validated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When validation checks were last run
    validation_rule_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # Hash of rule config used for validation
    # LLM qualitative check tracking fields
    llm_check_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="skipped"
    )  # pending|running|success|failed|skipped
    llm_rules_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # Hash of qualitative rules/config used
    llm_input_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # Hash of normalized monitored field values
    llm_model_used: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )  # Model used for qualitative checks
    llm_job_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )  # Async job id for queue tracking
    llm_queued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # Time job was enqueued
    llm_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # Time worker started processing
    llm_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # Time worker completed processing
    llm_last_error: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # Last worker/API error (if any)
    # The run (pull) that last queued this submission's AI review.
    llm_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    survey_config: Mapped["SurveyConfig"] = relationship(
        "SurveyConfig", back_populates="submissions"
    )
    history: Mapped[list["SubmissionHistory"]] = relationship(
        "SubmissionHistory", back_populates="submission", cascade="all, delete-orphan"
    )


class SubmissionHistory(Base):
    """ORM model for submissions_history table."""

    __tablename__ = "submissions_history"

    history_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kobo_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("submissions_current._id", ondelete="CASCADE"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    deprecated_uuid: Mapped[str] = mapped_column(String(255), nullable=False)
    data_delta: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    # Relationships
    submission: Mapped["SubmissionCurrent"] = relationship(
        "SubmissionCurrent", back_populates="history"
    )


class AIConnection(Base):
    """
    A user's own AI key: an OpenAI-compatible endpoint for AI review
    (``kind="review"``), or an ElevenLabs key for transcription
    (``kind="transcription"``).

    Owned by a user and attached to surveys they own. The key is encrypted
    at rest and never returned by the API (``api_key_hint`` is).
    """

    __tablename__ = "ai_connections"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # review: AI review and rule writing (OpenAI-compatible);
    # transcription: audio transcription (ElevenLabs).
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="review")
    # openai | azure | anthropic | openrouter | mistral | groq | self_hosted | custom | elevenlabs
    preset: Mapped[str] = mapped_column(String(32), nullable=False, default="custom")
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_encrypted: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # NULL for keyless self-hosted servers
    api_key_hint: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )  # last 4 characters, for display
    check_model: Mapped[str] = mapped_column(String(128), nullable=False)
    rule_model: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )  # falls back to check_model
    capabilities: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True
    )  # learned request profile
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="untested"
    )  # untested | ok | failing
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)  # "<category>: <message>"
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AIUsage(Base):
    """
    One AI call: what it was for, which model, how many tokens, how it ended.

    The free allowance counts these, and the usage view reads them. No prompt
    or reply text is stored.
    """

    __tablename__ = "ai_usage"

    usage_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    # qualitative_check | rule_generation | rule_suggestion
    feature: Mapped[str] = mapped_column(String(32), nullable=False)
    submission_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # qualitative checks only
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # as reported by the provider
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)  # "ok" or an AIError category
    connection_id: Mapped[uuid.UUID | None] = mapped_column(  # NULL: the operator's key
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )
    # Who asked, for user-triggered calls (rule writing); NULL for background checks.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # The account the call counts against: the survey's owner when it was made.
    # Recorded, not derived later, because a survey can change hands.
    billed_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    cached_input_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # part of input, billed lower
    reasoning_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )  # part of output, billed as output
    # List-price cost when the call was made, in millionths of a dollar; NULL
    # when the model is not in the price table.
    cost_usd_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Transcription only: seconds of audio. Reserved before the call (outcome
    # "reserved") so concurrent transcriptions cannot overshoot the allowance.
    audio_seconds: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class SurveyAccess(Base):
    """ORM model for survey_access table - manages shared access to surveys."""

    __tablename__ = "survey_access"

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    permission_level: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'editor' or 'viewer'
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    # Relationships
    survey: Mapped["SurveyConfig"] = relationship("SurveyConfig", back_populates="shared_access")
    user: Mapped["User"] = relationship(
        "User", back_populates="survey_access", foreign_keys=[user_id]
    )
    granter: Mapped["User | None"] = relationship("User", foreign_keys=[granted_by])


# Run statuses. "queued" and "running" are the pull itself (one at a time per
# survey); "background" is the AI reviews, transcriptions and Kobo sends it
# started, which may overlap a later pull.
RUN_ACTIVE = ("queued", "running")
RUN_OPEN = ("queued", "running", "background")

# A work item (AI review, transcript, translation) not yet finished, and a send
# to Kobo not yet made. An AI review can also be waiting on its transcripts.
ITEM_OPEN = ("pending", "running")
AI_REVIEW_OPEN = (*ITEM_OPEN, "waiting")
KOBO_SEND_OPEN = ("pending",)


class Run(Base):
    """
    A pull, or a re-run, and the background work it started.

    Progress is counted from the items that point back at it
    (``submissions_current.llm_run_id``, ``audio_transcripts.run_id`` and
    ``kobo_run_id``), so it never drifts from what actually happened.
    """

    __tablename__ = "runs"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    # pull | ai_rerun | transcription_rerun | kobo_resend
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    started_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # queued | running | background | finished | failed | stopped
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    # queued | fetching | checking | background | done
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    stats: Mapped[Any | None] = mapped_column(JSONB, nullable=True)  # the pull's counts
    error: Mapped[str | None] = mapped_column(Text, nullable=True)  # why a pull failed, in words
    task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stopped_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index(
            "idx_runs_one_active_per_survey",
            "survey_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
            sqlite_where=text("status IN ('queued', 'running')"),
        ),
    )


class AudioTranscript(Base):
    """
    The transcript of one audio answer, and whether it was sent to Kobo.

    The recording is never stored here: the worker downloads it from Kobo,
    sends it to ElevenLabs and deletes it. See docs/specs/audio-transcription.md.
    """

    __tablename__ = "audio_transcripts"

    transcript_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id: Mapped[int] = mapped_column(Integer, nullable=False)  # Kobo _id
    question_path: Mapped[str] = mapped_column(
        String(255), nullable=False
    )  # e.g. interview/q_story
    attachment_uid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # Kobo download_url
    attachment_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    input_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # a change re-transcribes
    # elevenlabs: transcribed here | kobo: Kobo's own transcript, read on pull
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="elevenlabs", server_default="elevenlabs"
    )
    # pending | running | success | failed | skipped | not_run_allowance | cancelled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    skip_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # missing_file | too_long | no_speech
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    segments: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True
    )  # speaker turns, when diarised
    language_code: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # ISO 639-3, as detected
    language_probability: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    audio_seconds: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)  # "<category>: <message>"
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    # Whose Kobo token downloads the recording: the user who started the run.
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # not_sent | pending | sent | failed | unsupported | edited_in_kobo
    kobo_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_sent")
    kobo_language: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # the code Kobo stored it under
    kobo_version_uuid: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # the version we created
    kobo_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    kobo_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kobo_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    kobo_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("survey_id", "submission_id", "question_path"),
        Index("idx_audio_transcripts_run", "run_id", "status"),
    )


class AnswerTranslation(Base):
    """
    One answer translated into the survey's translation language by its AI
    provider: a typed answer to a text question, or the transcript of an
    audio question. A translated transcript can be sent to Kobo as Kobo's
    translation of the question.

    One per (submission, question): a survey translates into one language. A
    new text (an edited answer, a transcript made again or corrected in Kobo)
    or another language translates it again. See docs/specs/translation.md.
    """

    __tablename__ = "answer_translations"

    translation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id: Mapped[int] = mapped_column(Integer, nullable=False)  # Kobo _id
    question_path: Mapped[str] = mapped_column(String(255), nullable=False)
    # text: a typed answer | transcript: an audio answer's transcript
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="text")
    transcript_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("audio_transcripts.transcript_id", ondelete="CASCADE"),
        nullable=True,
    )
    language: Mapped[str] = mapped_column(String(16), nullable=False)  # ISO 639-3, the target
    # ai: translated here | kobo: the translation Kobo shows, read on pull
    # (never translated again, nor sent back)
    origin: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ai", server_default="ai"
    )
    input_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # the text + the target
    # pending | running | success | failed | skipped | not_run_allowance | cancelled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    skip_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )  # same_language | no_text
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)  # "<category>: <message>"
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    # Whose Kobo token sends it: the user who started the run.
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # not_sent | pending | sent | failed | unsupported | edited_in_kobo
    kobo_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_sent")
    kobo_language: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # the code Kobo stored it under
    kobo_version_uuid: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # the version we created
    kobo_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    kobo_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kobo_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    kobo_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("survey_id", "submission_id", "question_path"),
        Index("idx_answer_translations_run", "run_id", "status"),
        Index("idx_answer_translations_kobo_run", "kobo_run_id", "kobo_status"),
        Index("idx_answer_translations_transcript", "transcript_id"),
    )


class Notification(Base):
    """An in-app notification: a run finished or failed, or work paused."""

    __tablename__ = "notifications"

    notification_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    survey_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=True,
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # run_finished | run_failed | paused
    severity: Mapped[str] = mapped_column(
        String(16), nullable=False, default="info"
    )  # info | warning
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True
    )  # {"view": "dashboard", "survey_id": ..., "filters": {...}}
    # One unread notification per key: a repeated pause updates it.
    dedupe_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppEvent(Base):
    """
    One thing someone did in the app -- signed up, logged in, used it on a
    day, connected Kobo, added a survey -- for the admin usage figures.

    Rows outlive what they describe: user_id and survey_id are plain columns
    set to NULL (users) or kept (surveys) when those go, so deleting an
    account or a survey does not rewrite past figures.
    """

    __tablename__ = "app_events"

    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    survey_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )  # no FK: kept after a delete
    details: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True
    )  # e.g. signup source {"utm_source": ...}
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    __table_args__ = (Index("idx_app_events_kind_created", "kind", "created_at"),)

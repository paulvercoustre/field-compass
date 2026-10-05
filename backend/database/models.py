"""
SQLAlchemy ORM models for database tables.
These models map to the PostgreSQL schema defined in schema.sql.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
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
    # Last authenticated request; moves at most once a day (services/app_events.py)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

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
    # The survey owner's own AI provider; NULL uses the operator's key.
    ai_connection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )
    # The owner's own ElevenLabs key for transcription; NULL uses the
    # operator's, within the included usage.
    transcription_connection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )

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
    # The run (pull) that last queued this submission's AI review.
    llm_run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
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


class AIConnection(Base):
    """
    A user's own AI key: an OpenAI-compatible endpoint for AI review
    (``kind="review"``), or an ElevenLabs key for transcription
    (``kind="transcription"``).

    Owned by a user and attached to surveys they own. The key is encrypted
    at rest and never returned by the API (``api_key_hint`` is).
    """

    __tablename__ = "ai_connections"

    connection_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    label = Column(String(120), nullable=False)
    # review: AI review and rule writing (OpenAI-compatible);
    # transcription: audio transcription (ElevenLabs).
    kind = Column(String(16), nullable=False, default="review")
    # openai | azure | anthropic | openrouter | mistral | groq | self_hosted | custom | elevenlabs
    preset = Column(String(32), nullable=False, default="custom")
    base_url = Column(Text, nullable=False)
    api_key_encrypted = Column(Text, nullable=True)  # NULL for keyless self-hosted servers
    api_key_hint = Column(String(8), nullable=True)  # last 4 characters, for display
    check_model = Column(String(128), nullable=False)
    rule_model = Column(String(128), nullable=True)  # falls back to check_model
    capabilities = Column(JSONB, nullable=True)  # learned request profile
    status = Column(String(16), nullable=False, default="untested")  # untested | ok | failing
    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)  # "<category>: <message>"
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class AIUsage(Base):
    """
    One AI call: what it was for, which model, how many tokens, how it ended.

    The free allowance counts these, and the usage view reads them. No prompt
    or reply text is stored.
    """

    __tablename__ = "ai_usage"

    usage_id = Column(Integer, primary_key=True, autoincrement=True)
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    # qualitative_check | rule_generation | rule_suggestion
    feature = Column(String(32), nullable=False)
    submission_id = Column(Integer, nullable=True)  # qualitative checks only
    model = Column(String(128), nullable=False)
    input_tokens = Column(Integer, nullable=True)  # as reported by the provider
    output_tokens = Column(Integer, nullable=True)
    outcome = Column(String(32), nullable=False)  # "ok" or an AIError category
    connection_id = Column(  # NULL: the operator's key
        UUID(as_uuid=True),
        ForeignKey("ai_connections.connection_id", ondelete="SET NULL"),
        nullable=True,
    )
    # Who asked, for user-triggered calls (rule writing); NULL for background checks.
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # The account the call counts against: the survey's owner when it was made.
    # Recorded, not derived later, because a survey can change hands.
    billed_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    cached_input_tokens = Column(Integer, nullable=True)  # part of input, billed lower
    reasoning_tokens = Column(Integer, nullable=True)  # part of output, billed as output
    # List-price cost when the call was made, in millionths of a dollar; NULL
    # when the model is not in the price table.
    cost_usd_micros = Column(BigInteger, nullable=True)
    # Transcription only: seconds of audio. Reserved before the call (outcome
    # "reserved") so concurrent transcriptions cannot overshoot the allowance.
    audio_seconds = Column(Numeric(10, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


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


# Run statuses. "queued" and "running" are the pull itself (one at a time per
# survey); "background" is the AI reviews, transcriptions and Kobo sends it
# started, which may overlap a later pull.
RUN_ACTIVE = ("queued", "running")
RUN_OPEN = ("queued", "running", "background")


class Run(Base):
    """
    A pull, or a re-run, and the background work it started.

    Progress is counted from the items that point back at it
    (``submissions_current.llm_run_id``, ``audio_transcripts.run_id`` and
    ``kobo_run_id``), so it never drifts from what actually happened.
    """

    __tablename__ = "runs"

    run_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    # pull | ai_rerun | transcription_rerun | kobo_resend
    kind = Column(String(32), nullable=False)
    started_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # queued | running | background | finished | failed | stopped
    status = Column(String(16), nullable=False, default="queued")
    # queued | fetching | checking | background | done
    stage = Column(String(16), nullable=False, default="queued")
    stats = Column(JSONB, nullable=True)  # the pull's counts
    error = Column(Text, nullable=True)  # why a pull failed, in words
    task_id = Column(String(128), nullable=True)
    stopped_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

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

    transcript_id = Column(Integer, primary_key=True, autoincrement=True)
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id = Column(Integer, nullable=False)  # Kobo _id
    question_path = Column(String(255), nullable=False)  # e.g. interview/q_story
    attachment_uid = Column(String(128), nullable=True)
    attachment_url = Column(Text, nullable=True)  # Kobo download_url
    attachment_filename = Column(String(255), nullable=True)
    input_hash = Column(String(64), nullable=True)  # a change re-transcribes
    # elevenlabs: transcribed here | kobo: Kobo's own transcript, read on pull
    source = Column(String(16), nullable=False, default="elevenlabs", server_default="elevenlabs")
    # pending | running | success | failed | skipped | not_run_allowance | cancelled
    status = Column(String(20), nullable=False, default="pending")
    skip_reason = Column(String(32), nullable=True)  # missing_file | too_long | no_speech
    text = Column(Text, nullable=True)
    segments = Column(JSONB, nullable=True)  # speaker turns, when diarised
    language_code = Column(String(16), nullable=True)  # ISO 639-3, as detected
    language_probability = Column(Numeric(5, 4), nullable=True)
    audio_seconds = Column(Numeric(10, 2), nullable=True)
    model = Column(String(64), nullable=True)
    last_error = Column(Text, nullable=True)  # "<category>: <message>"
    run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    # Whose Kobo token downloads the recording: the user who started the run.
    requested_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    job_id = Column(String(128), nullable=True)
    queued_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    # not_sent | pending | sent | failed | unsupported | edited_in_kobo
    kobo_status = Column(String(20), nullable=False, default="not_sent")
    kobo_language = Column(String(16), nullable=True)  # the code Kobo stored it under
    kobo_version_uuid = Column(String(64), nullable=True)  # the version we created
    kobo_attempted_at = Column(DateTime(timezone=True), nullable=True)
    kobo_sent_at = Column(DateTime(timezone=True), nullable=True)
    kobo_last_error = Column(Text, nullable=True)
    kobo_run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("survey_id", "submission_id", "question_path"),
        Index("idx_audio_transcripts_run", "run_id", "status"),
    )


class TranscriptTranslation(Base):
    """
    A transcript translated into the survey's translation language by its AI
    provider, and whether it was sent to Kobo as Kobo's translation.

    One per transcript: a survey translates into one language. A new
    transcript text (re-transcribed, corrected in Kobo) or another target
    language translates it again. See docs/specs/transcript-translation.md.
    """

    __tablename__ = "transcript_translations"

    translation_id = Column(Integer, primary_key=True, autoincrement=True)
    transcript_id = Column(
        Integer,
        ForeignKey("audio_transcripts.transcript_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id = Column(Integer, nullable=False)  # Kobo _id
    question_path = Column(String(255), nullable=False)
    language = Column(String(16), nullable=False)  # ISO 639-3, the target
    input_hash = Column(String(64), nullable=True)  # transcript text + target
    # pending | running | success | failed | skipped | not_run_allowance | cancelled
    status = Column(String(20), nullable=False, default="pending")
    skip_reason = Column(String(32), nullable=True)  # same_language | no_speech
    text = Column(Text, nullable=True)
    model = Column(String(64), nullable=True)
    last_error = Column(Text, nullable=True)  # "<category>: <message>"
    run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    # Whose Kobo token sends it: the user who started the run.
    requested_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    job_id = Column(String(128), nullable=True)
    queued_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    # not_sent | pending | sent | failed | unsupported | edited_in_kobo
    kobo_status = Column(String(20), nullable=False, default="not_sent")
    kobo_language = Column(String(16), nullable=True)  # the code Kobo stored it under
    kobo_version_uuid = Column(String(64), nullable=True)  # the version we created
    kobo_attempted_at = Column(DateTime(timezone=True), nullable=True)
    kobo_sent_at = Column(DateTime(timezone=True), nullable=True)
    kobo_last_error = Column(Text, nullable=True)
    kobo_run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_transcript_translations_run", "run_id", "status"),
        Index("idx_transcript_translations_kobo_run", "kobo_run_id", "kobo_status"),
        Index("idx_transcript_translations_submission", "survey_id", "submission_id"),
    )


class Notification(Base):
    """An in-app notification: a run finished or failed, or work paused."""

    __tablename__ = "notifications"

    notification_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    survey_id = Column(
        UUID(as_uuid=True),
        ForeignKey("survey_configs.survey_id", ondelete="CASCADE"),
        nullable=True,
    )
    run_id = Column(
        UUID(as_uuid=True), ForeignKey("runs.run_id", ondelete="SET NULL"), nullable=True
    )
    kind = Column(String(32), nullable=False)  # run_finished | run_failed | paused
    severity = Column(String(16), nullable=False, default="info")  # info | warning
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(JSONB, nullable=True)  # {"view": "dashboard", "survey_id": ..., "filters": {...}}
    # One unread notification per key: a repeated pause updates it.
    dedupe_key = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    read_at = Column(DateTime(timezone=True), nullable=True)


class AppEvent(Base):
    """
    One thing someone did in the app -- signed up, logged in, used it on a
    day, connected Kobo, added a survey -- for the admin usage figures.

    Rows outlive what they describe: user_id and survey_id are plain columns
    set to NULL (users) or kept (surveys) when those go, so deleting an
    account or a survey does not rewrite past figures.
    """

    __tablename__ = "app_events"

    event_id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String(32), nullable=False)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    survey_id = Column(UUID(as_uuid=True), nullable=True)  # no FK: kept after a delete
    details = Column(JSONB, nullable=True)  # e.g. signup source {"utm_source": ...}
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_app_events_kind_created", "kind", "created_at"),)

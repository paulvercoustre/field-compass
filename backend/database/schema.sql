-- ============================================================================
-- Field Compass Database Schema
-- ============================================================================
-- This schema defines the PostgreSQL database structure for the Field Compass
-- QA platform. All survey data is stored using JSONB for flexibility.
-- ============================================================================

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Table: users
-- ============================================================================
-- User accounts with authentication and per-user Kobo API credentials.
-- Kobo tokens are encrypted at rest (Fernet) and never returned by the API.
-- ============================================================================

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    -- Kobo API credentials (encrypted at rest)
    kobo_api_token_encrypted TEXT,
    kobo_api_url VARCHAR(500) DEFAULT 'https://kf.kobotoolbox.org/api/v2',
    -- Account status
    is_active BOOLEAN DEFAULT TRUE,
    is_admin BOOLEAN DEFAULT FALSE,
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE users IS 'User accounts with authentication and Kobo API credentials';
COMMENT ON COLUMN users.user_id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN users.email IS 'User email address, unique, used for login';
COMMENT ON COLUMN users.username IS 'Username, unique, used for display';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password';
COMMENT ON COLUMN users.kobo_api_token_encrypted IS 'Fernet-encrypted Kobo API token';
COMMENT ON COLUMN users.kobo_api_url IS 'Kobo API base URL (defaults to kf.kobotoolbox.org)';
COMMENT ON COLUMN users.is_active IS 'Whether user account is active';
COMMENT ON COLUMN users.is_admin IS 'Whether user has admin privileges';
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of last successful login';
COMMENT ON COLUMN users.last_seen_at IS 'Last authenticated request; updated at most once a day';

CREATE TABLE ai_connections (
    connection_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'review',
    preset VARCHAR(32) NOT NULL DEFAULT 'custom',
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT,
    api_key_hint VARCHAR(8),
    check_model VARCHAR(128) NOT NULL,
    rule_model VARCHAR(128),
    capabilities JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'untested',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_tested_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ai_connections IS 'Users'' own AI keys: OpenAI-compatible (kind review) or ElevenLabs (kind transcription); key encrypted, never returned';
COMMENT ON COLUMN ai_connections.kind IS 'review: AI review and rule writing; transcription: audio transcription';

-- ============================================================================
-- Table: survey_configs
-- ============================================================================
-- Stores survey-specific configuration settings (replaces config.R from legacy)
-- Each survey has its own configuration for variables, sampling, PII, etc.
-- ============================================================================

CREATE TABLE survey_configs (
    survey_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_name VARCHAR(255) NOT NULL,
    kobo_asset_id VARCHAR(255),
    config_data JSONB NOT NULL,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ai_connection_id UUID REFERENCES ai_connections(connection_id) ON DELETE SET NULL,
    transcription_connection_id UUID REFERENCES ai_connections(connection_id) ON DELETE SET NULL,
    translation_connection_id UUID REFERENCES ai_connections(connection_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(survey_name)
);

COMMENT ON TABLE survey_configs IS 'Survey-specific configuration settings';
COMMENT ON COLUMN survey_configs.survey_id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN survey_configs.survey_name IS 'Human-readable survey name';
COMMENT ON COLUMN survey_configs.kobo_asset_id IS 'KoboToolbox asset ID for API integration';
COMMENT ON COLUMN survey_configs.user_id IS 'Owner user ID, NULL for system/legacy surveys';
COMMENT ON COLUMN survey_configs.config_data IS 'JSONB containing all survey configuration: core identifiers, sampling frame, special values, PII columns, roster configs, global parameters';

-- ============================================================================
-- Table: runs
-- ============================================================================
-- One pull (or re-run) and the background work it started: AI reviews,
-- transcriptions, transcripts sent to Kobo. Progress is counted from the
-- items that point back at their run.
-- ============================================================================

CREATE TABLE runs (
    run_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    started_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    stage VARCHAR(16) NOT NULL DEFAULT 'queued',
    stats JSONB,
    error TEXT,
    task_id VARCHAR(128),
    stopped_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE runs IS 'A pull or re-run and the background work it started; drives progress and notifications';
COMMENT ON COLUMN runs.status IS 'queued | running (fetching, checking) | background | finished | failed | stopped';

-- ============================================================================
-- Table: validation_rules
-- ============================================================================
-- Stores high-frequency check (HFC) validation rules for each survey
-- Rules are stored as JSONB for flexibility and can be versioned
-- ============================================================================

CREATE TABLE validation_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    rule_name VARCHAR(255) NOT NULL,
    rule_data JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(survey_id, rule_name)
);

COMMENT ON TABLE validation_rules IS 'High-frequency check validation rules for data quality';
COMMENT ON COLUMN validation_rules.rule_id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN validation_rules.survey_id IS 'Foreign key to survey_configs';
COMMENT ON COLUMN validation_rules.rule_name IS 'Human-readable rule name/identifier';
COMMENT ON COLUMN validation_rules.rule_data IS 'JSONB containing rule definition: issue message, check_id, roster_name, variables_involved, check_expression';
COMMENT ON COLUMN validation_rules.is_active IS 'Whether this rule is currently active and should be evaluated';

-- ============================================================================
-- Table: submissions_current
-- ============================================================================
-- Primary table storing current state of all survey submissions
-- Uses _id (INTEGER) as stable primary key from KoboToolbox
-- ============================================================================

CREATE TABLE submissions_current (
    _id INTEGER PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE RESTRICT,
    _uuid VARCHAR(255) NOT NULL,
    _submission_time TIMESTAMP WITH TIME ZONE NOT NULL,
    "end" TIMESTAMP WITH TIME ZONE NOT NULL,
    submission_data JSONB NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    has_edit_history BOOLEAN DEFAULT FALSE,
    data_quality_issues JSONB DEFAULT '[]'::JSONB,
    qa_status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
    dk_count INTEGER,
    dk_eligible_count INTEGER,
    dk_percentage NUMERIC(5,2),
    kobo_validation_status VARCHAR(50),
    kobo_edit_url VARCHAR(500),
    reviewer_notes TEXT,
    last_validated_at TIMESTAMP WITH TIME ZONE,
    validation_rule_hash VARCHAR(64),
    llm_check_status VARCHAR(20) DEFAULT 'skipped' NOT NULL,
    llm_rules_hash VARCHAR(64),
    llm_input_hash VARCHAR(64),
    llm_model_used VARCHAR(128),
    llm_job_id VARCHAR(128),
    llm_queued_at TIMESTAMP WITH TIME ZONE,
    llm_started_at TIMESTAMP WITH TIME ZONE,
    llm_checked_at TIMESTAMP WITH TIME ZONE,
    llm_last_error TEXT,
    llm_run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(_uuid)
);

COMMENT ON TABLE submissions_current IS 'Current state of all survey submissions';
COMMENT ON COLUMN submissions_current._id IS 'Primary key from KoboToolbox, stable identifier that never changes';
COMMENT ON COLUMN submissions_current.survey_id IS 'Foreign key to survey_configs, links submission to survey configuration';
COMMENT ON COLUMN submissions_current._uuid IS 'KoboToolbox UUID, may change on edits';
COMMENT ON COLUMN submissions_current._submission_time IS 'Original submission timestamp from KoboToolbox';
COMMENT ON COLUMN submissions_current."end" IS 'End timestamp, used to detect edits (if end > _submission_time + 300s, considered edited)';
COMMENT ON COLUMN submissions_current.submission_data IS 'Complete survey data as JSONB, includes all fields and nested rosters';
COMMENT ON COLUMN submissions_current.is_edited IS 'Whether this submission has been edited after initial submission';
COMMENT ON COLUMN submissions_current.has_edit_history IS 'Permanent flag: submission was edited at least once (is_edited is cleared after revalidation)';
COMMENT ON COLUMN submissions_current.data_quality_issues IS 'JSONB array of quality issues found by HFC: [{check, field, value, message}, ...]';
COMMENT ON COLUMN submissions_current.qa_status IS 'QA status: FLAGGED, PENDING_APPROVAL, PENDING_RE_QA, APPROVED';
COMMENT ON COLUMN submissions_current.dk_count IS 'Count of DK answers for eligible questions in this submission';
COMMENT ON COLUMN submissions_current.dk_eligible_count IS 'Count of eligible question instances included in DK denominator';
COMMENT ON COLUMN submissions_current.dk_percentage IS 'DK percentage for this submission (dk_count / dk_eligible_count * 100)';
COMMENT ON COLUMN submissions_current.kobo_validation_status IS 'KoboToolbox validation status: Approved, Not Approved, On Hold, or NULL';
COMMENT ON COLUMN submissions_current.kobo_edit_url IS 'Deep link to view/edit this submission in Kobo';
COMMENT ON COLUMN submissions_current.reviewer_notes IS 'Optional free-text notes entered by reviewers';
COMMENT ON COLUMN submissions_current.last_validated_at IS 'When validation checks last ran, for incremental revalidation';
COMMENT ON COLUMN submissions_current.validation_rule_hash IS 'Hash of the rule config used at last validation';
COMMENT ON COLUMN submissions_current.llm_check_status IS 'Status of qualitative LLM checks: pending, running, success, failed, skipped';
COMMENT ON COLUMN submissions_current.llm_rules_hash IS 'Hash of LLM qualitative rule/config at last run';
COMMENT ON COLUMN submissions_current.llm_input_hash IS 'Hash of normalized qualitative input values at last run';
COMMENT ON COLUMN submissions_current.llm_model_used IS 'Model name used for the latest LLM qualitative check';
COMMENT ON COLUMN submissions_current.llm_job_id IS 'Queue job id for the last qualitative check task';
COMMENT ON COLUMN submissions_current.llm_queued_at IS 'When qualitative check was queued';
COMMENT ON COLUMN submissions_current.llm_started_at IS 'When qualitative check processing started';
COMMENT ON COLUMN submissions_current.llm_checked_at IS 'When qualitative check completed';
COMMENT ON COLUMN submissions_current.llm_last_error IS 'Most recent error for qualitative checks';

-- ============================================================================
-- Table: submissions_history
-- ============================================================================
-- Audit log of all changes made to submissions
-- Stores JSON patches (diffs) for traceability
-- ============================================================================

CREATE TABLE submissions_history (
    history_id SERIAL PRIMARY KEY,
    kobo_id INTEGER NOT NULL REFERENCES submissions_current(_id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deprecated_uuid VARCHAR(255) NOT NULL,
    data_delta JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE submissions_history IS 'Audit log of all submission edits';
COMMENT ON COLUMN submissions_history.history_id IS 'Primary key, auto-incrementing';
COMMENT ON COLUMN submissions_history.kobo_id IS 'Foreign key to submissions_current._id';
COMMENT ON COLUMN submissions_history.timestamp IS 'When the edit occurred (from KoboToolbox end timestamp)';
COMMENT ON COLUMN submissions_history.deprecated_uuid IS 'Previous UUID before the edit';
COMMENT ON COLUMN submissions_history.data_delta IS 'JSON patch array showing what changed: [{op: add|remove|replace, path, value}, ...]';

-- ============================================================================
-- Table: survey_access
-- ============================================================================
-- Junction table granting non-owner users access to a survey.
-- ============================================================================

CREATE TABLE survey_access (
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('editor', 'viewer')),
    granted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (survey_id, user_id)
);

COMMENT ON TABLE survey_access IS 'Junction table for sharing surveys with users';
COMMENT ON COLUMN survey_access.permission_level IS 'Access level: editor (can run ETL, resolve flags) or viewer (read-only)';
COMMENT ON COLUMN survey_access.granted_by IS 'User who granted this access';

CREATE TABLE ai_usage (
    usage_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    feature VARCHAR(32) NOT NULL,
    submission_id INTEGER,
    model VARCHAR(128) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    outcome VARCHAR(32) NOT NULL,
    connection_id UUID REFERENCES ai_connections(connection_id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    billed_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    cached_input_tokens INTEGER,
    reasoning_tokens INTEGER,
    cost_usd_micros BIGINT,
    audio_seconds NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ai_usage IS 'One row per AI call; counted for the free allowance. No prompt or reply text.';
COMMENT ON COLUMN ai_usage.outcome IS 'ok, or the failure category (auth, rate_limited, ...)';

COMMENT ON COLUMN ai_usage.audio_seconds IS 'Transcription only: seconds of audio sent (reserved before the call, settled after)';

-- ============================================================================
-- Table: audio_transcripts
-- ============================================================================
-- One row per (submission, audio question) chosen for transcription. The
-- recording itself is never stored: it is read from Kobo when needed.
-- ============================================================================

CREATE TABLE audio_transcripts (
    transcript_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL,
    question_path VARCHAR(255) NOT NULL,
    attachment_uid VARCHAR(128),
    attachment_url TEXT,
    attachment_filename VARCHAR(255),
    input_hash VARCHAR(64),
    source VARCHAR(16) NOT NULL DEFAULT 'elevenlabs',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    skip_reason VARCHAR(32),
    text TEXT,
    segments JSONB,
    language_code VARCHAR(16),
    language_probability NUMERIC(5, 4),
    audio_seconds NUMERIC(10, 2),
    model VARCHAR(64),
    last_error TEXT,
    run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    requested_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    job_id VARCHAR(128),
    queued_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    kobo_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
    kobo_language VARCHAR(16),
    kobo_version_uuid VARCHAR(64),
    kobo_attempted_at TIMESTAMP WITH TIME ZONE,
    kobo_sent_at TIMESTAMP WITH TIME ZONE,
    kobo_last_error TEXT,
    kobo_run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (survey_id, submission_id, question_path)
);

COMMENT ON TABLE audio_transcripts IS 'Transcripts of audio answers (ElevenLabs), and whether each was sent to Kobo';
COMMENT ON COLUMN audio_transcripts.source IS 'elevenlabs (transcribed by Field Compass) | kobo (the transcript Kobo shows, read on pull; never transcribed again)';
COMMENT ON COLUMN audio_transcripts.status IS 'pending | running | success | failed | skipped | not_run_allowance | cancelled';
COMMENT ON COLUMN audio_transcripts.kobo_status IS 'not_sent | pending | sent | failed | unsupported | edited_in_kobo';

-- ============================================================================
-- Table: answer_translations
-- ============================================================================
-- Answers translated into the survey's translation language by its AI
-- provider: typed answers to text questions, and transcripts of audio ones.
-- One per (submission, question).
-- ============================================================================

CREATE TABLE answer_translations (
    translation_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL,
    question_path VARCHAR(255) NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'text',
    transcript_id BIGINT REFERENCES audio_transcripts(transcript_id) ON DELETE CASCADE,
    language VARCHAR(16) NOT NULL,
    origin VARCHAR(16) NOT NULL DEFAULT 'ai',
    input_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    skip_reason VARCHAR(32),
    text TEXT,
    model VARCHAR(64),
    last_error TEXT,
    run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    requested_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    job_id VARCHAR(128),
    queued_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    kobo_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
    kobo_language VARCHAR(16),
    kobo_version_uuid VARCHAR(64),
    kobo_attempted_at TIMESTAMP WITH TIME ZONE,
    kobo_sent_at TIMESTAMP WITH TIME ZONE,
    kobo_last_error TEXT,
    kobo_run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (survey_id, submission_id, question_path)
);

COMMENT ON TABLE answer_translations IS 'Answers (typed, or transcripts) translated by the survey''s AI provider, and whether each transcript translation was sent to Kobo';
COMMENT ON COLUMN answer_translations.origin IS 'ai (translated by Field Compass) | kobo (the translation Kobo shows, read on pull; never translated again)';
COMMENT ON COLUMN answer_translations.source IS 'text (a typed answer) | transcript (an audio answer''s transcript)';
COMMENT ON COLUMN answer_translations.status IS 'pending | running | success | failed | skipped | not_run_allowance | cancelled';
COMMENT ON COLUMN answer_translations.kobo_status IS 'not_sent | pending | sent | failed | unsupported | edited_in_kobo';

-- ============================================================================
-- Table: notifications
-- ============================================================================

CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    survey_id UUID REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    kind VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link JSONB,
    dedupe_key VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE notifications IS 'In-app notifications: a run finished or failed, or work paused for a reason someone must fix';

-- ============================================================================
-- Table: app_events
-- ============================================================================

CREATE TABLE app_events (
    event_id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(32) NOT NULL,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    survey_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE app_events IS 'What people did in the app (signup, login, active_day, kobo_connected, survey_created...), for the admin usage figures';
COMMENT ON COLUMN app_events.survey_id IS 'No foreign key on purpose: the event outlives a deleted survey';

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- Survey access indexes
CREATE INDEX idx_survey_access_user ON survey_access(user_id);
CREATE INDEX idx_survey_access_survey ON survey_access(survey_id);

-- AI usage: the monthly allowance count per survey
CREATE INDEX idx_ai_usage_survey_created ON ai_usage(survey_id, created_at);
CREATE INDEX idx_ai_connections_owner ON ai_connections(owner_user_id);
CREATE INDEX idx_ai_usage_user_created ON ai_usage(user_id, created_at);
CREATE INDEX idx_ai_usage_billed_created ON ai_usage(billed_user_id, created_at);

-- Survey configs indexes
CREATE INDEX idx_survey_configs_name ON survey_configs(survey_name);
CREATE INDEX idx_survey_configs_user_id ON survey_configs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_survey_configs_kobo_asset ON survey_configs(kobo_asset_id) WHERE kobo_asset_id IS NOT NULL;

-- Validation rules indexes
CREATE INDEX idx_validation_rules_survey_id ON validation_rules(survey_id);
CREATE INDEX idx_validation_rules_active ON validation_rules(survey_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_validation_rules_rule_data ON validation_rules USING GIN(rule_data);

-- Submissions current indexes
CREATE INDEX idx_submissions_survey_id ON submissions_current(survey_id);
CREATE INDEX idx_submissions_uuid ON submissions_current(_uuid);
CREATE INDEX idx_submissions_qa_status ON submissions_current(qa_status);
CREATE INDEX idx_submissions_is_edited ON submissions_current(is_edited);
CREATE INDEX idx_submissions_has_edit_history ON submissions_current(has_edit_history)
    WHERE has_edit_history = TRUE;
CREATE INDEX idx_submissions_validation_tracking
    ON submissions_current(last_validated_at, validation_rule_hash);
CREATE INDEX idx_submissions_submission_time ON submissions_current(_submission_time);
CREATE INDEX idx_submissions_submission_data ON submissions_current USING GIN(submission_data);
CREATE INDEX idx_submissions_quality_issues ON submissions_current USING GIN(data_quality_issues);
CREATE INDEX idx_submissions_llm_status ON submissions_current(llm_check_status);
CREATE INDEX idx_submissions_llm_hashes ON submissions_current(survey_id, llm_rules_hash, llm_input_hash);
CREATE INDEX idx_submissions_llm_job_id ON submissions_current(llm_job_id);
CREATE INDEX idx_submissions_llm_run ON submissions_current(llm_run_id, llm_check_status)
    WHERE llm_run_id IS NOT NULL;

-- Runs, transcripts, notifications
-- One pull at a time per survey: a second request gets "already running".
CREATE UNIQUE INDEX idx_runs_one_active_per_survey ON runs(survey_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX idx_runs_survey_created ON runs(survey_id, created_at);
CREATE INDEX idx_runs_status ON runs(status) WHERE status IN ('queued', 'running', 'background');
CREATE INDEX idx_audio_transcripts_run ON audio_transcripts(run_id, status);
CREATE INDEX idx_audio_transcripts_kobo_run ON audio_transcripts(kobo_run_id, kobo_status);
CREATE INDEX idx_audio_transcripts_submission ON audio_transcripts(survey_id, submission_id);
CREATE INDEX idx_answer_translations_run ON answer_translations(run_id, status);
CREATE INDEX idx_answer_translations_kobo_run ON answer_translations(kobo_run_id, kobo_status);
CREATE INDEX idx_answer_translations_transcript ON answer_translations(transcript_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_app_events_kind_created ON app_events(kind, created_at);
-- Composite index for common triage queue queries
CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id)
    WHERE qa_status IN ('FLAGGED', 'PENDING_RE_QA');

-- Submissions history indexes
CREATE INDEX idx_history_kobo_id ON submissions_history(kobo_id);
CREATE INDEX idx_history_timestamp ON submissions_history(timestamp);
CREATE INDEX idx_history_deprecated_uuid ON submissions_history(deprecated_uuid);
CREATE INDEX idx_history_data_delta ON submissions_history USING GIN(data_delta);

-- ============================================================================
-- Triggers for updated_at timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_survey_configs_updated_at 
    BEFORE UPDATE ON survey_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_validation_rules_updated_at 
    BEFORE UPDATE ON validation_rules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_submissions_current_updated_at 
    BEFORE UPDATE ON submissions_current 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audio_transcripts_updated_at
    BEFORE UPDATE ON audio_transcripts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_answer_translations_updated_at
    BEFORE UPDATE ON answer_translations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Example: Sample JSONB structure for survey_configs.config_data
-- ============================================================================
/*
{
  "core_identifiers": {
    "uuid": "_uuid",
    "enumerator": "enumerator_id",
    "date_interview": "today",
    "start_time": "start",
    "end_time": "end",
    "consent": "consent",
    "audit": "audit_URL"
  },
  "sampling_frame": {
    "sampling_cols": ["sampling_admin2", "sampling_livelihood"],
    "admin_level_for_label": "sampling_admin2",
    "admin_level_choice_name": "sampling_admin2"
  },
  "special_values": {
    "dk_value": -99,
    "dk_string_value": "dk"
  },
  "pii_cols": null,
  "roster_processing": {
    "roster_uuid": "_submission__uuid",
    "roster_configs": {
      "product_roster": {
        "name_column": "product_description",
        "value_columns": ["product_unit", "product_production_quant", "product_sales_quant", "product_price"]
      }
    }
  },
  "global_parameters": {
    "data_collection_start_date": "2025-08-26",
    "data_collection_end_date": "2025-09-26",
    "min_survey_duration_minutes": 10,
    "max_survey_duration_minutes": 240
  }
}
*/

-- ============================================================================
-- Example: Sample JSONB structure for validation_rules.rule_data
-- ============================================================================
/*
{
  "issue": "Income value is too high (above 700k AFN)",
  "check_id": "high_income",
  "roster_name": null,
  "variables_involved": ["sampling_admin2", "income"],
  "check_expression": "sampling_admin2 != 'zaranj' & income > 700000"
}
*/

-- ============================================================================
-- Example: Sample JSONB structure for submissions_current.data_quality_issues
-- ============================================================================
/*
[
  {
    "check": "Outlier",
    "field": "age",
    "value": 99,
    "message": "Age 99 is above the 95th percentile (90)."
  },
  {
    "check": "Internal Consistency",
    "field": "q_children_count",
    "value": 1,
    "message": "q_children_count is > 0 but child roster is empty."
  }
]
*/

-- ============================================================================
-- Example: Sample JSONB structure for submissions_history.data_delta
-- ============================================================================
/*
[
  {
    "op": "replace",
    "path": "/age",
    "value": 99
  },
  {
    "op": "replace",
    "path": "/income",
    "value": 150000
  },
  {
    "op": "add",
    "path": "/q_roster_children/1",
    "value": {
      "child_name": "Jim",
      "child_age": 8
    }
  }
]
*/


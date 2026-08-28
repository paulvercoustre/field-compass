-- ============================================================================
-- Migration 006: reconcile an existing database with schema.sql
-- ============================================================================
-- Fixing schema.sql alone does NOT repair a database that already exists.
-- Postgres only runs /docker-entrypoint-initdb.d on an EMPTY data directory,
-- so the production volume created before this fix keeps whatever it was
-- built with -- in practice: no `users` table, no `survey_access` table, and
-- five columns missing from submissions_current. Every login and every
-- registration returned a 500.
--
-- This script brings any such database up to the current schema. Every
-- statement is idempotent (IF NOT EXISTS / OR REPLACE), so it is safe to run
-- on every deploy and safe to run against a database that is already correct,
-- which is exactly how docker-compose.prod.yml invokes it.
--
-- Manual run:
--   psql -U postgres -d field_compass -f 006_sync_schema_with_models.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    kobo_api_token_encrypted TEXT,
    kobo_api_url VARCHAR(500) DEFAULT 'https://kf.kobotoolbox.org/api/v2',
    is_active BOOLEAN DEFAULT TRUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- survey_configs ownership
-- ----------------------------------------------------------------------------

ALTER TABLE survey_configs
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_survey_configs_user_id
    ON survey_configs(user_id) WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- survey_access
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS survey_access (
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('editor', 'viewer')),
    granted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (survey_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_survey_access_user ON survey_access(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_access_survey ON survey_access(survey_id);

-- ----------------------------------------------------------------------------
-- submissions_current
-- ----------------------------------------------------------------------------
-- Two groups, both handled here because this is the ONLY migration the deploy
-- runs. A database is reconciled in one step regardless of how old it is, so
-- every column the ORM writes has to be listed -- not just the ones that were
-- missing from the most recent schema.sql.
--
-- Group 1 was folded into schema.sql in Feb 2026 (04a77c0), so any database
-- built from that file onwards -- which includes the current production
-- volume -- already has them and these are no-ops. A database created before
-- that commit does not, and without these its submissions queries would fail
-- on `reviewer_notes` even once registration worked again.
ALTER TABLE submissions_current
    ADD COLUMN IF NOT EXISTS dk_count INTEGER,
    ADD COLUMN IF NOT EXISTS dk_eligible_count INTEGER,
    ADD COLUMN IF NOT EXISTS dk_percentage NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS reviewer_notes TEXT,
    ADD COLUMN IF NOT EXISTS llm_check_status VARCHAR(20) DEFAULT 'skipped' NOT NULL,
    ADD COLUMN IF NOT EXISTS llm_rules_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS llm_input_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS llm_model_used VARCHAR(128),
    ADD COLUMN IF NOT EXISTS llm_job_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS llm_queued_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS llm_started_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS llm_checked_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS llm_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_llm_status
    ON submissions_current(llm_check_status);
CREATE INDEX IF NOT EXISTS idx_submissions_llm_hashes
    ON submissions_current(survey_id, llm_rules_hash, llm_input_hash);
CREATE INDEX IF NOT EXISTS idx_submissions_llm_job_id
    ON submissions_current(llm_job_id);

-- Group 2 was never in schema.sql at all: these are the columns whose absence
-- is being fixed in the same change as this migration.
ALTER TABLE submissions_current
    ADD COLUMN IF NOT EXISTS has_edit_history BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS kobo_validation_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS kobo_edit_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS validation_rule_hash VARCHAR(64);

-- Backfill the permanent edit flag from the history table for rows that
-- predate the column.
UPDATE submissions_current
SET has_edit_history = TRUE
WHERE has_edit_history IS NOT TRUE
  AND (is_edited = TRUE OR _id IN (SELECT DISTINCT kobo_id FROM submissions_history));

CREATE INDEX IF NOT EXISTS idx_submissions_has_edit_history
    ON submissions_current(has_edit_history) WHERE has_edit_history = TRUE;
CREATE INDEX IF NOT EXISTS idx_submissions_validation_tracking
    ON submissions_current(last_validated_at, validation_rule_hash);

-- The application writes 'PENDING_APPROVAL' and 'FLAGGED'; the original schema
-- defaulted to 'PENDING_QA' and indexed 'HFC_FLAGGED', neither of which the
-- code has used since. The partial index therefore matched no rows and the
-- triage queue query it exists for could never use it.
ALTER TABLE submissions_current ALTER COLUMN qa_status SET DEFAULT 'PENDING_APPROVAL';

DROP INDEX IF EXISTS idx_submissions_triage;
CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id)
    WHERE qa_status IN ('FLAGGED', 'PENDING_RE_QA');

-- ----------------------------------------------------------------------------
-- updated_at trigger for users
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Postgres has no CREATE TRIGGER IF NOT EXISTS.
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

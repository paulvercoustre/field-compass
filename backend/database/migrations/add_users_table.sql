-- ============================================================================
-- Migration: Add Users Table with Kobo API Key Management
-- ============================================================================
-- This migration adds user authentication and per-user Kobo API key storage.
-- API keys are encrypted at rest using Fernet symmetric encryption.
-- ============================================================================

-- ============================================================================
-- Table: users
-- ============================================================================
-- Stores user accounts with encrypted Kobo API credentials.
-- Each user can have their own Kobo API key for data fetching.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
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
    last_login_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE users IS 'User accounts with authentication and Kobo API credentials';
COMMENT ON COLUMN users.user_id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN users.email IS 'User email address, unique, used for login';
COMMENT ON COLUMN users.username IS 'Username, unique, used for display';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password';
COMMENT ON COLUMN users.full_name IS 'User full name for display';
COMMENT ON COLUMN users.kobo_api_token_encrypted IS 'Fernet-encrypted Kobo API token';
COMMENT ON COLUMN users.kobo_api_url IS 'Kobo API base URL (defaults to kf.kobotoolbox.org)';
COMMENT ON COLUMN users.is_active IS 'Whether user account is active';
COMMENT ON COLUMN users.is_admin IS 'Whether user has admin privileges';
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of last successful login';

-- ============================================================================
-- Add user_id foreign key to survey_configs (for multi-tenancy)
-- ============================================================================
-- This links surveys to the user who created them.
-- Existing surveys will have NULL user_id (backward compatible).
-- ============================================================================

ALTER TABLE survey_configs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN survey_configs.user_id IS 'Owner user ID, NULL for system/legacy surveys';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_survey_configs_user_id ON survey_configs(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- Trigger for updated_at
-- ============================================================================

-- Drop trigger if exists, then create (PostgreSQL doesn't support IF NOT EXISTS for triggers)
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Note: To run this migration manually:
-- psql -d field_compass -f add_users_table.sql
-- ============================================================================


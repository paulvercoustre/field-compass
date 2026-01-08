-- Migration: Add survey_access table for user-to-survey permissions
-- This enables sharing surveys between users with different permission levels

-- Create survey_access junction table
CREATE TABLE IF NOT EXISTS survey_access (
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('editor', 'viewer')),
    granted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (survey_id, user_id)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_survey_access_user ON survey_access(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_access_survey ON survey_access(survey_id);

-- Add comments
COMMENT ON TABLE survey_access IS 'Junction table for sharing surveys with users';
COMMENT ON COLUMN survey_access.permission_level IS 'Access level: editor (can run ETL, resolve flags) or viewer (read-only)';
COMMENT ON COLUMN survey_access.granted_by IS 'User who granted this access';


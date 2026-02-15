-- Migration: Add validation tracking fields to submissions_current
-- Created: 2026-02-12
-- Purpose: Enable incremental validation by tracking when submissions were last validated
--          and which rule version was used, reducing unnecessary revalidation

-- Add validation tracking columns
ALTER TABLE submissions_current 
ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS validation_rule_hash VARCHAR(64);

-- Add index for efficient querying of validation status
CREATE INDEX IF NOT EXISTS idx_submissions_validation_tracking 
ON submissions_current(last_validated_at, validation_rule_hash);

-- Set initial values: mark all existing submissions as needing validation
-- (last_validated_at = NULL means they'll be revalidated on next ETL run)
UPDATE submissions_current 
SET last_validated_at = NULL 
WHERE last_validated_at IS NULL;

-- Note: On first ETL run after this migration, all submissions will be revalidated
-- (one-time cost). Subsequent runs will be incremental and much faster.

-- Optional: To avoid revalidating all submissions on first run, you can set
-- last_validated_at to updated_at for submissions that already have quality issues:
-- UPDATE submissions_current 
-- SET last_validated_at = updated_at 
-- WHERE data_quality_issues IS NOT NULL AND last_validated_at IS NULL;

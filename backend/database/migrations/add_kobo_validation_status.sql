-- Migration: Add kobo_validation_status column to submissions_current
-- Date: 2025-11-09
-- Description: Store Kobo's validation status to sync with Field Compass status

ALTER TABLE submissions_current 
ADD COLUMN kobo_validation_status VARCHAR(50);

COMMENT ON COLUMN submissions_current.kobo_validation_status IS 'KoboToolbox validation status: Approved, Not Approved, On Hold, or null';

-- Update existing records to have null validation status
UPDATE submissions_current SET kobo_validation_status = NULL WHERE kobo_validation_status IS NULL;

-- Update the triage index to use new status values
DROP INDEX IF EXISTS idx_submissions_triage;
CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id) 
    WHERE qa_status IN ('FLAGGED', 'PENDING_RE_QA');


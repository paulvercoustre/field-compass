-- Migration: Add has_edit_history field to submissions_current
-- This is a permanent flag that indicates if a submission was ever edited
-- Unlike is_edited which gets reset after validation, this persists forever

ALTER TABLE submissions_current 
ADD COLUMN IF NOT EXISTS has_edit_history BOOLEAN DEFAULT FALSE;

-- Set has_edit_history = TRUE for all submissions that have history records
-- (meaning they were edited at least once)
UPDATE submissions_current 
SET has_edit_history = TRUE
WHERE _id IN (
    SELECT DISTINCT kobo_id 
    FROM submissions_history
);

-- Also set has_edit_history = TRUE for submissions currently marked as is_edited
UPDATE submissions_current 
SET has_edit_history = TRUE
WHERE is_edited = TRUE;

-- Create index for efficient querying of edited submissions
CREATE INDEX IF NOT EXISTS idx_submissions_has_edit_history 
ON submissions_current(has_edit_history)
WHERE has_edit_history = TRUE;

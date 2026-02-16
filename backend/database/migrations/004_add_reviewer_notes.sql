-- Migration: Add reviewer_notes field to submissions_current
-- Created: 2026-02-16
-- Purpose: Allow reviewers to store free-text notes directly on submissions

ALTER TABLE submissions_current
ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;

COMMENT ON COLUMN submissions_current.reviewer_notes IS 'Optional free-text notes entered by reviewers';

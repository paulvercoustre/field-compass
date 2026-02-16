-- Migration: Add per-submission DK metrics columns
-- Stores ETL-computed DK counts and percentages for faster dashboard aggregation.

ALTER TABLE submissions_current
ADD COLUMN IF NOT EXISTS dk_count INTEGER,
ADD COLUMN IF NOT EXISTS dk_eligible_count INTEGER,
ADD COLUMN IF NOT EXISTS dk_percentage NUMERIC(5,2);

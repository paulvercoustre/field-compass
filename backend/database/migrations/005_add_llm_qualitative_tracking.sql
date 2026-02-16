-- Migration: Add LLM qualitative tracking fields to submissions_current
-- Created: 2026-02-16
-- Purpose: Track async qualitative LLM check status and hashes per submission

ALTER TABLE submissions_current
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

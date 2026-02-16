-- ============================================================================
-- Field Compass Database Schema
-- ============================================================================
-- This schema defines the PostgreSQL database structure for the Field Compass
-- QA platform. All survey data is stored using JSONB for flexibility.
-- ============================================================================

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(survey_name)
);

COMMENT ON TABLE survey_configs IS 'Survey-specific configuration settings';
COMMENT ON COLUMN survey_configs.survey_id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN survey_configs.survey_name IS 'Human-readable survey name';
COMMENT ON COLUMN survey_configs.kobo_asset_id IS 'KoboToolbox asset ID for API integration';
COMMENT ON COLUMN survey_configs.config_data IS 'JSONB containing all survey configuration: core identifiers, sampling frame, special values, PII columns, roster configs, global parameters';

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
    data_quality_issues JSONB DEFAULT '[]'::JSONB,
    qa_status VARCHAR(50) DEFAULT 'PENDING_QA',
    dk_count INTEGER,
    dk_eligible_count INTEGER,
    dk_percentage NUMERIC(5,2),
    reviewer_notes TEXT,
    llm_check_status VARCHAR(20) DEFAULT 'skipped' NOT NULL,
    llm_rules_hash VARCHAR(64),
    llm_input_hash VARCHAR(64),
    llm_model_used VARCHAR(128),
    llm_job_id VARCHAR(128),
    llm_queued_at TIMESTAMP WITH TIME ZONE,
    llm_started_at TIMESTAMP WITH TIME ZONE,
    llm_checked_at TIMESTAMP WITH TIME ZONE,
    llm_last_error TEXT,
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
COMMENT ON COLUMN submissions_current.data_quality_issues IS 'JSONB array of quality issues found by HFC: [{check, field, value, message}, ...]';
COMMENT ON COLUMN submissions_current.qa_status IS 'QA status: HFC_FLAGGED, PENDING_QA, PENDING_RE_QA, APPROVED';
COMMENT ON COLUMN submissions_current.dk_count IS 'Count of DK answers for eligible questions in this submission';
COMMENT ON COLUMN submissions_current.dk_eligible_count IS 'Count of eligible question instances included in DK denominator';
COMMENT ON COLUMN submissions_current.dk_percentage IS 'DK percentage for this submission (dk_count / dk_eligible_count * 100)';
COMMENT ON COLUMN submissions_current.reviewer_notes IS 'Optional free-text notes entered by reviewers';
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
-- Indexes for Performance
-- ============================================================================

-- Survey configs indexes
CREATE INDEX idx_survey_configs_name ON survey_configs(survey_name);
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
CREATE INDEX idx_submissions_submission_time ON submissions_current(_submission_time);
CREATE INDEX idx_submissions_submission_data ON submissions_current USING GIN(submission_data);
CREATE INDEX idx_submissions_quality_issues ON submissions_current USING GIN(data_quality_issues);
CREATE INDEX idx_submissions_llm_status ON submissions_current(llm_check_status);
CREATE INDEX idx_submissions_llm_hashes ON submissions_current(survey_id, llm_rules_hash, llm_input_hash);
CREATE INDEX idx_submissions_llm_job_id ON submissions_current(llm_job_id);
-- Composite index for common triage queue queries
CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id) 
    WHERE qa_status IN ('HFC_FLAGGED', 'PENDING_RE_QA');

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

CREATE TRIGGER update_survey_configs_updated_at 
    BEFORE UPDATE ON survey_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_validation_rules_updated_at 
    BEFORE UPDATE ON validation_rules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_submissions_current_updated_at 
    BEFORE UPDATE ON submissions_current 
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


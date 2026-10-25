"""Record checks already on, for the usage funnel

Revision ID: 0023_backfill_checks_on
Revises: 0022_survey_server_and_names
Create Date: 2026-10-25

The usage funnel counts a survey's checks from the checks_on event, recorded
when a survey first has one on (services/app_events.record_checks_on). Surveys
set up before that event existed have none, so they would read as having no
check on. This records one for each of them, dated when the survey was last
changed and marked as backfilled: the date is a ceiling, not the day.

The conditions are services/survey_config.built_in_checks, in SQL, plus an
active rule of the survey's own. Idempotent: a survey that has the event is
skipped, so a second run adds nothing.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0023_backfill_checks_on"
down_revision: str | None = "0022_survey_server_and_names"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
INSERT INTO app_events (kind, user_id, survey_id, details, created_at)
SELECT 'checks_on', s.user_id, s.survey_id, '{"backfilled": true}'::jsonb,
       COALESCE(s.updated_at, s.created_at, CURRENT_TIMESTAMP)
FROM survey_configs s
WHERE NOT EXISTS (
    SELECT 1 FROM app_events e WHERE e.kind = 'checks_on' AND e.survey_id = s.survey_id
)
AND (
    EXISTS (
        SELECT 1 FROM validation_rules r WHERE r.survey_id = s.survey_id AND r.is_active
    )
    OR s.config_data -> 'quality_checks' ->> 'flag_out_of_period' = 'true'
    OR s.config_data -> 'quality_checks' ->> 'flag_weekend' = 'true'
    OR s.config_data -> 'quality_checks' ->> 'flag_office_hours' = 'true'
    OR s.config_data -> 'quality_checks' ->> 'flag_dk_percentage' = 'true'
    OR s.config_data -> 'quality_checks' ->> 'flag_empty_percentage' = 'true'
    OR s.config_data -> 'quality_checks' ->> 'flag_sampling_frame' = 'true'
    OR s.config_data -> 'global_parameters' ->> 'min_survey_duration_minutes' IS NOT NULL
    OR s.config_data -> 'global_parameters' ->> 'max_survey_duration_minutes' IS NOT NULL
    OR (
        s.config_data -> 'quality_checks' ->> 'flag_outliers' = 'true'
        -- CASE, because AND does not promise to test the type first
        AND CASE WHEN jsonb_typeof(s.config_data -> 'quality_checks' -> 'outlier_variables') = 'array'
            THEN jsonb_array_length(s.config_data -> 'quality_checks' -> 'outlier_variables') > 0
            ELSE false END
    )
    OR (
        s.config_data -> 'quality_checks' ->> 'flag_llm_qualitative' = 'true'
        -- CASE, because AND does not promise to test the type first
        AND CASE WHEN jsonb_typeof(s.config_data -> 'quality_checks' -> 'llm_qualitative_fields') = 'array'
            THEN jsonb_array_length(s.config_data -> 'quality_checks' -> 'llm_qualitative_fields') > 0
            ELSE false END
    )
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        "DELETE FROM app_events WHERE kind = 'checks_on' AND details ->> 'backfilled' = 'true'"
    )

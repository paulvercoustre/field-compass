"""Record every AI call in ai_usage

Revision ID: 0002_ai_usage
Revises: 0001_baseline
Create Date: 2026-10-01

One row per call to an AI provider: the survey, the feature, the model, the
tokens the provider reported, and how it ended. The free allowance counts
these rows (docs/specs/ai-provider-overhaul.md, sections 5.3 and 10).

`IF NOT EXISTS`, because a fresh database already has the table: schema.sql
creates it before Alembic first runs. The SQL is a module constant so
tests/test_schema_parity.py can check that every ORM column is reachable from
some revision.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_ai_usage"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS ai_usage (
    usage_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    feature VARCHAR(32) NOT NULL,
    submission_id INTEGER,
    model VARCHAR(128) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    outcome VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_survey_created ON ai_usage(survey_id, created_at);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai_usage")

"""Users' own AI providers, attachable to surveys

Revision ID: 0003_ai_connections
Revises: 0002_ai_usage
Create Date: 2026-10-02

ai_connections holds a user's OpenAI-compatible endpoint, encrypted key and
models; survey_configs.ai_connection_id attaches one to a survey (NULL uses
the operator's key); ai_usage.connection_id records which one a call used.
See docs/specs/ai-provider-overhaul.md, sections 5.1 and 5.2.

Idempotent, because a fresh database already has all of it from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_ai_connections"
down_revision: str | None = "0002_ai_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS ai_connections (
    connection_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    preset VARCHAR(32) NOT NULL DEFAULT 'custom',
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT,
    api_key_hint VARCHAR(8),
    check_model VARCHAR(128) NOT NULL,
    rule_model VARCHAR(128),
    capabilities JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'untested',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_tested_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_connections_owner ON ai_connections(owner_user_id);

ALTER TABLE survey_configs
    ADD COLUMN IF NOT EXISTS ai_connection_id UUID
        REFERENCES ai_connections(connection_id) ON DELETE SET NULL;

ALTER TABLE ai_usage
    ADD COLUMN IF NOT EXISTS connection_id UUID
        REFERENCES ai_connections(connection_id) ON DELETE SET NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai_usage DROP COLUMN IF EXISTS connection_id;
        ALTER TABLE survey_configs DROP COLUMN IF EXISTS ai_connection_id;
        DROP TABLE IF EXISTS ai_connections;
        """
    )

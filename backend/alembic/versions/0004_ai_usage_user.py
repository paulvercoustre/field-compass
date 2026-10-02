"""Record who asked for user-triggered AI calls

Revision ID: 0004_ai_usage_user
Revises: 0003_ai_connections
Create Date: 2026-10-02

The free allowance limits AI rule writing per user per day, so rule calls
record the user (docs/specs/ai-provider-overhaul.md, section 10). Background
checks leave it NULL. Idempotent: a fresh database has it from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004_ai_usage_user"
down_revision: str | None = "0003_ai_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
ALTER TABLE ai_usage
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE ai_usage DROP COLUMN IF EXISTS user_id")

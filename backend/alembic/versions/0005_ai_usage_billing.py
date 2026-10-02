"""Record who each AI call is billed to, and what it cost

Revision ID: 0005_ai_usage_billing
Revises: 0004_ai_usage_user
Create Date: 2026-10-02

Groundwork for paid AI plans: each ai_usage row records the account it counts
against (the survey's owner at the time), cached-input and reasoning tokens,
and its list-price cost in micro-dollars, worked out when the call was made.
Idempotent: a fresh database has the columns from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005_ai_usage_billing"
down_revision: str | None = "0004_ai_usage_user"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
ALTER TABLE ai_usage
    ADD COLUMN IF NOT EXISTS billed_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS cost_usd_micros BIGINT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_billed_created ON ai_usage(billed_user_id, created_at);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai_usage
            DROP COLUMN IF EXISTS cost_usd_micros,
            DROP COLUMN IF EXISTS reasoning_tokens,
            DROP COLUMN IF EXISTS cached_input_tokens,
            DROP COLUMN IF EXISTS billed_user_id;
        """
    )

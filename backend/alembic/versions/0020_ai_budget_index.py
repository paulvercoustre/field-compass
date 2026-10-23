"""An index for the monthly AI budget

Revision ID: 0020_ai_budget_index
Revises: 0019_sign_in_providers
Create Date: 2026-10-23

The monthly AI budget (services/ai_budget.py) adds up this month's calls on
Field Compass's own keys before every pull queues AI work. A partial index on
created_at, for those calls only, keeps that from reading the whole table.
Idempotent: a fresh database has it from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020_ai_budget_index"
down_revision: str | None = "0019_sign_in_providers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE INDEX IF NOT EXISTS idx_ai_usage_operator_created
    ON ai_usage(created_at) WHERE connection_id IS NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_ai_usage_operator_created;")

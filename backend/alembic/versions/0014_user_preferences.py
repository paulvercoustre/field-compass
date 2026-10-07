"""Per-user preferences, starting with how the review queue behaves

Revision ID: 0014_user_preferences
Revises: 0013_drop_pending_re_qa
Create Date: 2026-10-08

users.preferences holds a user's settings for how the app behaves, such as
opening the next submission after a decision. Null means the defaults.
Idempotent: a fresh database has the column from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014_user_preferences"
down_revision: str | None = "0013_drop_pending_re_qa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB;
COMMENT ON COLUMN users.preferences IS
    'How the app behaves for this user, e.g. auto_advance; null means the defaults';
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS preferences;")

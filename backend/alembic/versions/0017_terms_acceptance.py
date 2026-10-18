"""When each account accepted the terms of service

Revision ID: 0017_terms_acceptance
Revises: 0016_delete_ownerless_surveys
Create Date: 2026-10-18

users.terms_accepted_at and users.terms_version record when a user accepted the
terms of service and the data processing agreement at sign-up, and which
version (services/auth.py TERMS_VERSION). Accounts created before the terms
existed keep null. Idempotent: a fresh database has the columns from
schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017_terms_acceptance"
down_revision: str | None = "0016_delete_ownerless_surveys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);
COMMENT ON COLUMN users.terms_accepted_at IS
    'When the user accepted the terms of service and the data processing agreement; null for accounts from before them';
COMMENT ON COLUMN users.terms_version IS
    'Which version they accepted: the terms'' Last updated date, e.g. 2026-10-18';
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS terms_version;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at;")

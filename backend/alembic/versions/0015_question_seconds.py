"""Seconds on each question, from the Kobo audit log

Revision ID: 0015_question_seconds
Revises: 0014_user_preferences
Create Date: 2026-10-11

submissions_current.question_seconds holds the seconds spent on each question,
by its answer key (`hh/income`), coming back to it included, read from the
submission's audit log; a field-list screen is timed under its group's key.
Null when the submission has no audit log, or was pulled before. Data quality's
By question reads it. Idempotent: a fresh database has the column from
schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015_question_seconds"
down_revision: str | None = "0014_user_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE submissions_current ADD COLUMN IF NOT EXISTS question_seconds JSONB;
COMMENT ON COLUMN submissions_current.question_seconds IS
    'Seconds on each question, by answer key, from the Kobo audit log; a field-list screen under its group''s key';
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE submissions_current DROP COLUMN IF EXISTS question_seconds;")

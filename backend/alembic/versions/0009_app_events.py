"""App events and last-seen, for the admin usage figures

Revision ID: 0009_app_events
Revises: 0008_user_transcription_keys
Create Date: 2026-10-04

Logins only ever overwrote users.last_login_at, so how many people used the
app last week could not be answered. app_events records signups, logins,
days someone used the app, Kobo connections and survey changes; users.last_seen_at
lets the once-a-day "active" mark be decided without a query per request.
Idempotent: a fresh database has these from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009_app_events"
down_revision: str | None = "0008_user_transcription_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS app_events (
    event_id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(32) NOT NULL,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    survey_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_events_kind_created ON app_events(kind, created_at);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS app_events;
        ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
        """
    )

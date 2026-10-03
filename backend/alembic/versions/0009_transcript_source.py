"""Where a transcript came from: Field Compass, or Kobo

Revision ID: 0009_transcript_source
Revises: 0008_user_transcription_keys
Create Date: 2026-10-04

A recording that already has a transcript in Kobo (typed or corrected there,
or Kobo's own automatic one) is not transcribed again: the pull stores Kobo's
transcript with source 'kobo', and it is shown, checked and reviewed like
ours. Idempotent: a fresh database has the column from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009_transcript_source"
down_revision: str | None = "0008_user_transcription_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE audio_transcripts
    ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'elevenlabs';
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE audio_transcripts DROP COLUMN IF EXISTS source;")

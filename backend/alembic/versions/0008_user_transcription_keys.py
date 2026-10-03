"""Transcription keys as users' own AI connections, chosen per survey

Revision ID: 0008_user_transcription_keys
Revises: 0007_audio_transcripts
Create Date: 2026-10-03

A user's ElevenLabs key is an AI connection of kind "transcription", next to
their OpenAI-compatible ones (kind "review"), and a survey picks one with
survey_configs.transcription_connection_id, as it picks a review provider
with ai_connection_id. A transcription made on it records its connection_id
in ai_usage, so it is not counted against the included usage. Idempotent: a
fresh database has these from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008_user_transcription_keys"
down_revision: str | None = "0007_audio_transcripts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
ALTER TABLE ai_connections ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'review';

ALTER TABLE survey_configs
    ADD COLUMN IF NOT EXISTS transcription_connection_id UUID
        REFERENCES ai_connections(connection_id) ON DELETE SET NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE survey_configs DROP COLUMN IF EXISTS transcription_connection_id;
        ALTER TABLE ai_connections DROP COLUMN IF EXISTS kind;
        """
    )

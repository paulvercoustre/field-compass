"""Transcripts translated by the survey's AI provider

Revision ID: 0011_transcript_translations
Revises: 0010_transcript_source
Create Date: 2026-10-05

A survey can have its transcripts translated into one language by its AI
provider, and sent to Kobo as Kobo's translation of the question. See
docs/specs/transcript-translation.md. Idempotent: a fresh database has the
table from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011_transcript_translations"
down_revision: str | None = "0010_transcript_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS transcript_translations (
    translation_id BIGSERIAL PRIMARY KEY,
    transcript_id BIGINT NOT NULL UNIQUE REFERENCES audio_transcripts(transcript_id) ON DELETE CASCADE,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL,
    question_path VARCHAR(255) NOT NULL,
    language VARCHAR(16) NOT NULL,
    input_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    skip_reason VARCHAR(32),
    text TEXT,
    model VARCHAR(64),
    last_error TEXT,
    run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    requested_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    job_id VARCHAR(128),
    queued_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    kobo_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
    kobo_language VARCHAR(16),
    kobo_version_uuid VARCHAR(64),
    kobo_attempted_at TIMESTAMP WITH TIME ZONE,
    kobo_sent_at TIMESTAMP WITH TIME ZONE,
    kobo_last_error TEXT,
    kobo_run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transcript_translations_run
    ON transcript_translations(run_id, status);
CREATE INDEX IF NOT EXISTS idx_transcript_translations_kobo_run
    ON transcript_translations(kobo_run_id, kobo_status);
CREATE INDEX IF NOT EXISTS idx_transcript_translations_submission
    ON transcript_translations(survey_id, submission_id);

DROP TRIGGER IF EXISTS update_transcript_translations_updated_at ON transcript_translations;
CREATE TRIGGER update_transcript_translations_updated_at
    BEFORE UPDATE ON transcript_translations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS transcript_translations;")

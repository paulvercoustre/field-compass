"""Answers translated by the survey's AI provider

Revision ID: 0012_answer_translations
Revises: 0011_transcript_translations
Create Date: 2026-10-05

A survey can have answers translated into one language: typed answers to the
text questions it picks, and the transcripts of its audio questions. The
translation runs on the survey's own AI provider for translation
(survey_configs.translation_connection_id, chosen apart from AI review's), or
on the operator's key within the included translations. Translated
transcripts can be sent to Kobo. See docs/specs/translation.md.

Replaces transcript_translations, which a draft of 0011 made (translation of
transcripts only): it is dropped here if present. Idempotent: a fresh
database has all of this from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012_answer_translations"
down_revision: str | None = "0011_transcript_translations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
DROP TABLE IF EXISTS transcript_translations;

ALTER TABLE survey_configs
    ADD COLUMN IF NOT EXISTS translation_connection_id UUID
        REFERENCES ai_connections(connection_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS answer_translations (
    translation_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL,
    question_path VARCHAR(255) NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'text',
    transcript_id BIGINT REFERENCES audio_transcripts(transcript_id) ON DELETE CASCADE,
    language VARCHAR(16) NOT NULL,
    origin VARCHAR(16) NOT NULL DEFAULT 'ai',
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (survey_id, submission_id, question_path)
);
CREATE INDEX IF NOT EXISTS idx_answer_translations_run
    ON answer_translations(run_id, status);
CREATE INDEX IF NOT EXISTS idx_answer_translations_kobo_run
    ON answer_translations(kobo_run_id, kobo_status);
CREATE INDEX IF NOT EXISTS idx_answer_translations_transcript
    ON answer_translations(transcript_id);

DROP TRIGGER IF EXISTS update_answer_translations_updated_at ON answer_translations;
CREATE TRIGGER update_answer_translations_updated_at
    BEFORE UPDATE ON answer_translations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS answer_translations;
        ALTER TABLE survey_configs DROP COLUMN IF EXISTS translation_connection_id;
        """
    )

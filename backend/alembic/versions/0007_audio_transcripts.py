"""Transcripts of audio answers, and transcription minutes in ai_usage

Revision ID: 0007_audio_transcripts
Revises: 0006_runs_and_notifications
Create Date: 2026-10-03

Audio answers are transcribed with ElevenLabs and, optionally, sent to Kobo as
its own transcript of the question. ai_usage gains audio_seconds, since
transcription is billed per minute rather than per token. See
docs/specs/audio-transcription.md, part A. Idempotent: a fresh database has
these from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_audio_transcripts"
down_revision: str | None = "0006_runs_and_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS audio_seconds NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS audio_transcripts (
    transcript_id BIGSERIAL PRIMARY KEY,
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    submission_id INTEGER NOT NULL,
    question_path VARCHAR(255) NOT NULL,
    attachment_uid VARCHAR(128),
    attachment_url TEXT,
    attachment_filename VARCHAR(255),
    input_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    skip_reason VARCHAR(32),
    text TEXT,
    segments JSONB,
    language_code VARCHAR(16),
    language_probability NUMERIC(5, 4),
    audio_seconds NUMERIC(10, 2),
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
CREATE INDEX IF NOT EXISTS idx_audio_transcripts_run ON audio_transcripts(run_id, status);
CREATE INDEX IF NOT EXISTS idx_audio_transcripts_kobo_run ON audio_transcripts(kobo_run_id, kobo_status);
CREATE INDEX IF NOT EXISTS idx_audio_transcripts_submission ON audio_transcripts(survey_id, submission_id);

DROP TRIGGER IF EXISTS update_audio_transcripts_updated_at ON audio_transcripts;
CREATE TRIGGER update_audio_transcripts_updated_at
    BEFORE UPDATE ON audio_transcripts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS audio_transcripts;
        ALTER TABLE ai_usage DROP COLUMN IF EXISTS audio_seconds;
        """
    )

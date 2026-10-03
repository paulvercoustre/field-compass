"""Runs (a pull and the background work it started) and in-app notifications

Revision ID: 0006_runs_and_notifications
Revises: 0005_ai_usage_billing
Create Date: 2026-10-03

A pull becomes a recorded run with progress, counted from the AI reviews it
queued (submissions_current.llm_run_id). Notifications tell people when a run
finishes, fails, or work pauses. See docs/specs/audio-transcription.md, part B.
Idempotent: a fresh database has these from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006_runs_and_notifications"
down_revision: str | None = "0005_ai_usage_billing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    run_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    started_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    stage VARCHAR(16) NOT NULL DEFAULT 'queued',
    stats JSONB,
    error TEXT,
    task_id VARCHAR(128),
    stopped_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_per_survey ON runs(survey_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_runs_survey_created ON runs(survey_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)
    WHERE status IN ('queued', 'running', 'background');

ALTER TABLE submissions_current
    ADD COLUMN IF NOT EXISTS llm_run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_llm_run ON submissions_current(llm_run_id, llm_check_status)
    WHERE llm_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    survey_id UUID REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    run_id UUID REFERENCES runs(run_id) ON DELETE SET NULL,
    kind VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link JSONB,
    dedupe_key VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS notifications;
        ALTER TABLE submissions_current DROP COLUMN IF EXISTS llm_run_id;
        DROP TABLE IF EXISTS runs;
        """
    )

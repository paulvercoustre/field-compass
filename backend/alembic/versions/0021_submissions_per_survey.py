"""Key submissions by survey and Kobo _id together

Revision ID: 0021_submissions_per_survey
Revises: 0020_ai_budget_index
Create Date: 2026-10-25

Kobo's _id was the whole primary key of submissions_current, so a pull that
brought an _id already stored moved that row into the survey pulling it. Any
account could point its Kobo connection at a server it runs, answer with
guessed _ids, and take other accounts' submissions, notes and findings into
its own survey, or change their answers. Two surveys of one Kobo project, or
two Kobo servers with the same numbers, took each other's rows too.

The key is now (survey_id, _id), and _uuid is unique within a survey. Edit
history names its survey as well, so its foreign key follows the new key.
Nothing is lost: every existing _id is unique, so it stays unique within its
survey, and each history row takes its survey from its submission.

The old constraints are found by what they cover rather than by name, since
the production database is older than schema.sql's names. Idempotent: a
fresh database already has the new key from schema.sql, and is given it
again.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0021_submissions_per_survey"
down_revision: str | None = "0020_ai_budget_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE submissions_history ADD COLUMN IF NOT EXISTS survey_id UUID;
UPDATE submissions_history h SET survey_id = c.survey_id
    FROM submissions_current c
    WHERE h.survey_id IS NULL AND c._id = h.kobo_id;
-- None can be left: the old foreign key deleted history with its submission.
DELETE FROM submissions_history WHERE survey_id IS NULL;
ALTER TABLE submissions_history ALTER COLUMN survey_id SET NOT NULL;

DO $$
DECLARE
    item record;
    uuid_column int2 := (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'submissions_current'::regclass AND attname = '_uuid'
    );
BEGIN
    -- History's foreign key to the submissions, whatever its name.
    FOR item IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'submissions_history'::regclass
          AND confrelid = 'submissions_current'::regclass
          AND contype = 'f'
    LOOP
        EXECUTE format('ALTER TABLE submissions_history DROP CONSTRAINT %I', item.conname);
    END LOOP;
    -- The primary key, and anything that keeps _uuid unique.
    FOR item IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'submissions_current'::regclass
          AND (contype = 'p' OR (contype = 'u' AND uuid_column = ANY (conkey)))
    LOOP
        EXECUTE format('ALTER TABLE submissions_current DROP CONSTRAINT %I', item.conname);
    END LOOP;
    FOR item IN
        SELECT index_class.relname FROM pg_index
        JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
        WHERE pg_index.indrelid = 'submissions_current'::regclass
          AND pg_index.indisunique
          AND uuid_column = ANY (pg_index.indkey::int2[])
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = pg_index.indexrelid)
    LOOP
        EXECUTE format('DROP INDEX %I', item.relname);
    END LOOP;
END $$;

ALTER TABLE submissions_current
    ADD CONSTRAINT submissions_current_pkey PRIMARY KEY (survey_id, _id);
ALTER TABLE submissions_current
    ADD CONSTRAINT submissions_current_survey_uuid_key UNIQUE (survey_id, _uuid);
ALTER TABLE submissions_history
    ADD CONSTRAINT submissions_history_submission_fkey FOREIGN KEY (survey_id, kobo_id)
    REFERENCES submissions_current(survey_id, _id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_history_kobo_id;
CREATE INDEX IF NOT EXISTS idx_history_submission ON submissions_history(survey_id, kobo_id);

COMMENT ON COLUMN submissions_current._id IS
    'Submission ID from KoboToolbox; unique within the survey, not across surveys';
COMMENT ON COLUMN submissions_history.survey_id IS
    'With kobo_id, the submission: foreign key to submissions_current(survey_id, _id)';
COMMENT ON COLUMN submissions_history.kobo_id IS
    'With survey_id, the submission: foreign key to submissions_current(survey_id, _id)';
"""

# Back to one key for every survey: fails, changing nothing, once two surveys
# hold the same _id or _uuid.
DOWNGRADE_SQL = """
ALTER TABLE submissions_history DROP CONSTRAINT IF EXISTS submissions_history_submission_fkey;
ALTER TABLE submissions_current DROP CONSTRAINT IF EXISTS submissions_current_survey_uuid_key;
ALTER TABLE submissions_current DROP CONSTRAINT IF EXISTS submissions_current_pkey;
ALTER TABLE submissions_current ADD CONSTRAINT submissions_current_pkey PRIMARY KEY (_id);
ALTER TABLE submissions_current ADD CONSTRAINT submissions_current__uuid_key UNIQUE (_uuid);
ALTER TABLE submissions_history
    ADD CONSTRAINT submissions_history_kobo_id_fkey FOREIGN KEY (kobo_id)
    REFERENCES submissions_current(_id) ON DELETE CASCADE;
DROP INDEX IF EXISTS idx_history_submission;
CREATE INDEX IF NOT EXISTS idx_history_kobo_id ON submissions_history(kobo_id);
ALTER TABLE submissions_history DROP COLUMN IF EXISTS survey_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)

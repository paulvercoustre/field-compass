"""Each survey's Kobo server; survey names unique per owner

Revision ID: 0022_survey_server_and_names
Revises: 0021_submissions_per_survey
Create Date: 2026-10-25

survey_configs.kobo_api_url is the Kobo server the survey's project is on.
Pulls used the server of whoever started them, so an editor whose account
pointed elsewhere fed that server's data into a shared survey. Now every pull,
edit link and recording goes to the survey's own server. Existing surveys take
their owner's server, the one their pulls have used.

Survey names were unique across every account, so "a survey with this name
already exists" told anyone the names of other accounts' surveys. They are
unique among one owner's surveys now.

Idempotent: a fresh database has both from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0022_survey_server_and_names"
down_revision: str | None = "0021_submissions_per_survey"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE survey_configs ADD COLUMN IF NOT EXISTS kobo_api_url VARCHAR(500);
UPDATE survey_configs s
    SET kobo_api_url = COALESCE(NULLIF(TRIM(u.kobo_api_url), ''), 'https://kf.kobotoolbox.org/api/v2')
    FROM users u
    WHERE s.kobo_api_url IS NULL AND u.user_id = s.user_id;
UPDATE survey_configs SET kobo_api_url = 'https://kf.kobotoolbox.org/api/v2'
    WHERE kobo_api_url IS NULL;
COMMENT ON COLUMN survey_configs.kobo_api_url IS
    'API URL of the Kobo server the project is on; every pull and Kobo call for the survey goes there';

DO $$
DECLARE
    item record;
    name_column int2 := (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'survey_configs'::regclass AND attname = 'survey_name'
    );
BEGIN
    FOR item IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'survey_configs'::regclass
          AND contype = 'u'
          AND conkey = ARRAY[name_column]
    LOOP
        EXECUTE format('ALTER TABLE survey_configs DROP CONSTRAINT %I', item.conname);
    END LOOP;
END $$;
ALTER TABLE survey_configs DROP CONSTRAINT IF EXISTS survey_configs_user_name_key;
ALTER TABLE survey_configs
    ADD CONSTRAINT survey_configs_user_name_key UNIQUE (user_id, survey_name);
COMMENT ON COLUMN survey_configs.survey_name IS
    'Human-readable survey name, unique among its owner''s surveys';
"""

# Fails, changing nothing, once two owners have surveys of the same name.
DOWNGRADE_SQL = """
ALTER TABLE survey_configs DROP CONSTRAINT IF EXISTS survey_configs_user_name_key;
ALTER TABLE survey_configs ADD CONSTRAINT survey_configs_survey_name_key UNIQUE (survey_name);
ALTER TABLE survey_configs DROP COLUMN IF EXISTS kobo_api_url;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)

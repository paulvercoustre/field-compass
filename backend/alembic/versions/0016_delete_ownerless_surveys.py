"""Delete the surveys that have no owner

Revision ID: 0016_delete_ownerless_surveys
Revises: 0015_question_seconds
Create Date: 2026-10-16

Until the previous release, deleting an account left its surveys behind with no
owner: submissions, transcripts and translations included, with no one to ask
for them to be removed. scripts/create_survey_config.py made ownerless surveys
too. Both stopped; this removes what they left, with everything stored for
those surveys, and names each survey in the deploy's output.

The children are deleted explicitly rather than left to ON DELETE CASCADE, so
the migration does not depend on how old a database's constraints are.
Submissions first: their foreign key to the survey is RESTRICT.

There is no downgrade: the data is gone. The nightly backups keep it for up to
97 days.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0016_delete_ownerless_surveys"
down_revision: str | None = "0015_question_seconds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

OWNERLESS = "SELECT survey_id FROM survey_configs WHERE user_id IS NULL"

UPGRADE_SQL = f"""
DELETE FROM notifications WHERE survey_id IN ({OWNERLESS});
DELETE FROM answer_translations WHERE survey_id IN ({OWNERLESS});
DELETE FROM audio_transcripts WHERE survey_id IN ({OWNERLESS});
DELETE FROM ai_usage WHERE survey_id IN ({OWNERLESS});
DELETE FROM survey_access WHERE survey_id IN ({OWNERLESS});
DELETE FROM validation_rules WHERE survey_id IN ({OWNERLESS});
DELETE FROM submissions_history WHERE kobo_id IN (
    SELECT _id FROM submissions_current WHERE survey_id IN ({OWNERLESS})
);
DELETE FROM submissions_current WHERE survey_id IN ({OWNERLESS});
DELETE FROM runs WHERE survey_id IN ({OWNERLESS});
DELETE FROM survey_configs WHERE user_id IS NULL;

COMMENT ON COLUMN survey_configs.user_id IS 'Owner user ID. Deleting the account deletes its surveys (routers/users.py)';
"""


def upgrade() -> None:
    surveys = op.get_bind().execute(
        sa.text(
            "SELECT s.survey_id, s.survey_name,"
            " (SELECT count(*) FROM submissions_current c WHERE c.survey_id = s.survey_id)"
            " FROM survey_configs s WHERE s.user_id IS NULL ORDER BY s.created_at"
        )
    )
    for survey_id, name, submissions in surveys:
        logger.info(
            "Deleting survey %s (%r), which has no owner, with %s submissions",
            survey_id,
            name,
            submissions,
        )
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    # Nothing to undo in the schema; the deleted surveys are only in backups.
    pass

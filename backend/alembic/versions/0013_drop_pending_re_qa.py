"""Drop the PENDING_RE_QA status, which nothing ever set

Revision ID: 0013_drop_pending_re_qa
Revises: 0012_answer_translations
Create Date: 2026-10-05

PENDING_RE_QA came with the first version of the schema but no code ever wrote
it; only the triage index and one progress count still named it. The index is
rebuilt to cover FLAGGED alone. Any row that somehow carries the old value
becomes FLAGGED, which is how the progress count already treated it.
Idempotent: a fresh database has the new index from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013_drop_pending_re_qa"
down_revision: str | None = "0012_answer_translations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE_SQL = """
UPDATE submissions_current SET qa_status = 'FLAGGED' WHERE qa_status = 'PENDING_RE_QA';

DROP INDEX IF EXISTS idx_submissions_triage;
CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id)
    WHERE qa_status = 'FLAGGED';

COMMENT ON COLUMN submissions_current.qa_status IS
    'QA status: PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED';
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS idx_submissions_triage;
        CREATE INDEX idx_submissions_triage ON submissions_current(qa_status, survey_id)
            WHERE qa_status IN ('FLAGGED', 'PENDING_RE_QA');
        """
    )

"""Superseded: transcript translations, as first drafted

Revision ID: 0011_transcript_translations
Revises: 0010_transcript_source
Create Date: 2026-10-05

A draft of the translation feature created transcript_translations here. It
was replaced before release by answer_translations (0012), which also drops
the draft table where a development database has it. This revision stays, as
a no-op, so those databases can still upgrade from it.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011_transcript_translations"
down_revision: str | None = "0010_transcript_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS transcript_translations;")

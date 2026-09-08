"""Baseline: adopt Alembic over the existing schema

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-08

Every database this application has ever run against -- a fresh one built from
schema.sql, and the production volume that predates several columns -- is
brought to one known state by `006_sync_schema_with_models.sql`. Production has
been running that file on every deploy for exactly this reason.

So the baseline runs it once more, through Alembic, and records the fact. That
is what makes this safe to adopt on a live database without guessing:

    fresh database   schema.sql creates everything, 006 is a no-op, stamped 0001
    production       006 has been applied on every deploy, stamped 0001
    a database from
    before any of it 006 reconciles it, exactly as the deploy does today

There is deliberately no `alembic stamp` heuristic anywhere -- no code that
inspects a database, decides it "looks migrated" and skips ahead. Getting that
guess wrong on a database holding real submissions is not recoverable, and the
guess is unnecessary when the baseline is idempotent.

The SQL is read from the file rather than copied here. 006 is not a normal
migration: `test_schema_parity.py` requires it to keep covering every column
the ORM defines, so it is a living reconciliation, and a copy would be the one
the tests do not guard. Revisions from 0002 onward are ordinary immutable
Alembic revisions and carry their own SQL.
"""

from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa

from alembic import op

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# backend/alembic/versions/ -> backend/database/migrations/
RECONCILIATION_SQL = (
    Path(__file__).resolve().parents[2]
    / "database"
    / "migrations"
    / "006_sync_schema_with_models.sql"
)


def upgrade() -> None:
    if not RECONCILIATION_SQL.is_file():
        raise RuntimeError(
            f"baseline migration cannot find {RECONCILIATION_SQL}. It is part of the "
            "application image; if it is missing, the image is built wrong and the "
            "database must not be touched."
        )

    # sa.DDL, not sa.text: the script is one multi-statement file holding a
    # plpgsql body between $$ markers and string literals containing colons
    # ('https://kf.kobotoolbox.org/api/v2'), and text() would read those colons
    # as bind parameters. DDL passes the SQL through untouched.
    #
    # Not a raw exec_driver_sql either, which would work online and then throw
    # AttributeError under `alembic upgrade head --sql`. Offline rendering is
    # how you read what a migration will do to production before letting it.
    op.execute(sa.DDL(RECONCILIATION_SQL.read_text()))


def downgrade() -> None:
    raise NotImplementedError(
        "The baseline cannot be reversed. It reconciles a database up to the schema "
        "the application requires; undoing it means dropping tables that hold real "
        "submissions. Restore from a backup instead."
    )

"""
Guards against drift between the ORM models and schema.sql.

Why this exists
---------------
Production creates its database from `backend/database/schema.sql`, which
docker-compose.prod.yml mounts into the Postgres image's
/docker-entrypoint-initdb.d. The test suite, by contrast, builds its tables
from the SQLAlchemy models with `Base.metadata.create_all`.

Those are two independent definitions of the same schema, and nothing used to
compare them. When the `users` table was added to models.py but never added to
schema.sql, every test still passed -- the tests created the table themselves --
while production had no `users` table at all and every register/login request
died with "relation users does not exist" and a 500.

This test makes that class of bug impossible to merge: any table or column the
application relies on must exist in the file production actually runs.
"""

import re
from pathlib import Path

import pytest

from database.models import Base

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "database" / "schema.sql"


def _strip_comments(sql: str) -> str:
    """Remove /* block */ and -- line comments.

    schema.sql keeps large commented-out JSONB examples at the bottom that
    contain braces and commas; leaving them in would confuse the parser.
    """
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*", "", sql)
    return sql


def _split_top_level(body: str) -> list[str]:
    """Split a CREATE TABLE body on commas that are not inside parentheses.

    A naive split would break NUMERIC(5,2) and CHECK (x IN ('a','b')).
    """
    parts, depth, current = [], 0, []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if "".join(current).strip():
        parts.append("".join(current))
    return parts


def _table_body(sql: str, start: int) -> str:
    """Return the parenthesised body of a CREATE TABLE starting at `start`."""
    open_paren = sql.index("(", start)
    depth = 0
    for i in range(open_paren, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth == 0:
                return sql[open_paren + 1 : i]
    raise ValueError("unbalanced parentheses in CREATE TABLE")


# Words that begin a table constraint rather than a column definition.
_CONSTRAINT_KEYWORDS = {
    "primary",
    "unique",
    "foreign",
    "check",
    "constraint",
    "exclude",
    "like",
}


def parse_schema_sql(sql: str) -> dict[str, set[str]]:
    """Map table name -> set of column names, as defined by schema.sql.

    Understands CREATE TABLE and ALTER TABLE ... ADD COLUMN, which is all
    schema.sql uses.
    """
    sql = _strip_comments(sql)
    tables: dict[str, set[str]] = {}

    create_re = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?\s*\(",
        re.IGNORECASE,
    )
    for match in create_re.finditer(sql):
        table = match.group(1).lower()
        columns: set[str] = set()
        for item in _split_top_level(_table_body(sql, match.start())):
            item = item.strip()
            if not item:
                continue
            # Split on whitespace OR "(", so an inline constraint written
            # without a space -- UNIQUE(_uuid) -- is recognised as the keyword
            # UNIQUE rather than taken for a column named "unique(_uuid)".
            first = re.split(r"[\s(]", item, maxsplit=1)[0]
            if first.lower().strip('"') in _CONSTRAINT_KEYWORDS:
                continue
            columns.add(first.strip('"').lower())
        tables[table] = columns

    # One ALTER TABLE may carry several comma-separated ADD COLUMN clauses:
    #     ALTER TABLE t ADD COLUMN a INT, ADD COLUMN b TEXT;
    # so match the whole statement first, then every clause inside it. Matching
    # ADD COLUMN directly against the table name would find only the first.
    alter_re = re.compile(
        r"ALTER\s+TABLE\s+\"?(\w+)\"?\s(.*?);",
        re.IGNORECASE | re.DOTALL,
    )
    column_re = re.compile(
        r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?",
        re.IGNORECASE,
    )
    for match in alter_re.finditer(sql):
        table = match.group(1).lower()
        for column in column_re.finditer(match.group(2)):
            tables.setdefault(table, set()).add(column.group(1).strip('"').lower())

    return tables


@pytest.fixture(scope="module")
def schema_tables() -> dict[str, set[str]]:
    return parse_schema_sql(SCHEMA_PATH.read_text())


@pytest.fixture(scope="module")
def model_tables() -> dict[str, set[str]]:
    return {
        name.lower(): {column.name.lower() for column in table.columns}
        for name, table in Base.metadata.tables.items()
    }


def test_schema_file_is_parseable(schema_tables):
    """A parser that silently matches nothing would make every test below pass."""
    assert schema_tables, f"no CREATE TABLE statements parsed from {SCHEMA_PATH}"
    assert "survey_configs" in schema_tables


def test_every_model_table_exists_in_schema_sql(schema_tables, model_tables):
    """Production builds its database from schema.sql only.

    A table that exists in models.py but not here does not exist in production,
    and every query against it returns a 500.
    """
    missing = sorted(set(model_tables) - set(schema_tables))
    assert not missing, (
        f"tables defined in models.py but missing from {SCHEMA_PATH.name}: {missing}. "
        "Production creates its database from this file, so these tables would not "
        "exist there and every query against them would fail with a 500."
    )


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_every_model_column_exists_in_schema_sql(table_name, schema_tables, model_tables):
    """Same reasoning as above, one level down: a missing column is also a 500."""
    table = table_name.lower()
    if table not in schema_tables:
        pytest.skip(f"{table} missing entirely; reported by the table-level test")

    missing = sorted(model_tables[table] - schema_tables[table])
    assert not missing, (
        f"columns on '{table}' defined in models.py but missing from "
        f"{SCHEMA_PATH.name}: {missing}"
    )


# =============================================================================
# Migration 006 must be able to reconcile ANY historical database
# =============================================================================
# The deploy runs exactly one migration (see the `migrate` service in
# docker-compose.prod.yml), so that single file has to close the gap between
# the oldest database that could still exist and what the ORM writes today.
#
# It did not, at first: it added only the columns missing from the most recent
# schema.sql, and silently skipped the ones folded into schema.sql back in
# 04a77c0 (dk_*, reviewer_notes, llm_*). A database predating that commit would
# have gained a working `users` table and still failed on the first submissions
# query. This test pins the requirement so the next column added to models.py
# cannot be left out of the reconciliation.

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "database"
    / "migrations"
    / "006_sync_schema_with_models.sql"
)

# Columns present in the very first schema (b07bf1f). No database exists that
# predates these, so the reconciliation script does not need to add them.
# Tables absent here -- users, survey_access -- are created by 006 in full.
BASELINE_COLUMNS = {
    "survey_configs": {
        "survey_id",
        "survey_name",
        "kobo_asset_id",
        "config_data",
        "created_at",
        "updated_at",
    },
    "validation_rules": {
        "rule_id",
        "survey_id",
        "rule_name",
        "rule_data",
        "is_active",
        "created_at",
        "updated_at",
    },
    "submissions_current": {
        "_id",
        "survey_id",
        "_uuid",
        "_submission_time",
        "end",
        "submission_data",
        "is_edited",
        "data_quality_issues",
        "qa_status",
        "created_at",
        "updated_at",
    },
    "submissions_history": {
        "history_id",
        "kobo_id",
        "timestamp",
        "deprecated_uuid",
        "data_delta",
        "created_at",
    },
}


@pytest.fixture(scope="module")
def migration_tables() -> dict[str, set[str]]:
    return parse_schema_sql(MIGRATION_PATH.read_text())


def test_migration_file_is_parseable(migration_tables):
    assert migration_tables, f"nothing parsed from {MIGRATION_PATH}"
    assert "users" in migration_tables, "006 must create the users table"


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_migration_006_covers_every_model_column(table_name, migration_tables, model_tables):
    """Every ORM column must be either original, or added by migration 006.

    Anything else is a column that exists in models.py and in schema.sql, but
    that an already-provisioned database will never gain -- exactly the failure
    this migration exists to prevent.
    """
    table = table_name.lower()
    reachable = BASELINE_COLUMNS.get(table, set()) | migration_tables.get(table, set())

    missing = sorted(model_tables[table] - reachable)
    assert not missing, (
        f"columns on '{table}' that migration 006 would never add: {missing}. "
        "A database provisioned before these columns existed keeps failing on "
        f"them after the deploy. Add them to {MIGRATION_PATH.name}."
    )

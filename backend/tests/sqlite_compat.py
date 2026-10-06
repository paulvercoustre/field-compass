"""
An in-memory SQLite engine that can hold the Postgres schema.

The models use two Postgres-only column types, JSONB and UUID. The first
call swaps them, on the shared ``Base.metadata``, for types that use JSON and
a 36-character string on SQLite and the real types on Postgres; later calls
find nothing left to swap. Foreign keys are switched on, as Postgres enforces
them.
"""

import uuid

from sqlalchemy import JSON, Engine, String, TypeDecorator, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.pool import StaticPool

from database.models import Base


class JSONBForSQLite(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(JSON())
        return dialect.type_descriptor(JSONB())


class UUIDForSQLite(TypeDecorator):
    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String(36))
        return dialect.type_descriptor(PostgresUUID(as_uuid=True))

    def process_bind_param(self, value, dialect):
        if value is None or dialect.name != "sqlite":
            return value
        return value if isinstance(value, str) else str(value)

    def process_result_value(self, value, dialect):
        if value is None or dialect.name != "sqlite":
            return value
        return uuid.UUID(value) if isinstance(value, str) else value


def _use_sqlite_column_types() -> None:
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSONBForSQLite()
            elif isinstance(column.type, PostgresUUID):
                column.type = UUIDForSQLite()


def sqlite_engine() -> Engine:
    """A fresh in-memory database; call ``Base.metadata.create_all`` on it."""
    _use_sqlite_column_types()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys_on(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine

"""Alembic environment.

The database URL comes from DATABASE_URL and nowhere else. alembic.ini leaves
`sqlalchemy.url` empty on purpose: a default here would let a deploy with a
missing or misspelled variable migrate something other than the database the
application is about to use, and report success.

`target_metadata` is wired to the ORM models so `alembic revision --autogenerate`
can diff them against a live database. Autogenerate is a drafting aid, not an
oracle -- always read what it produces. It does not see CHECK constraints,
partial indexes, triggers or functions, all of which this schema uses.
"""

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import create_engine, pool

from alembic import context

# When alembic is invoked from backend/ this is redundant (prepend_sys_path in
# alembic.ini already covers it), but it also makes `alembic` work from the
# repository root, which is where people actually stand.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import Base  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Alembic will not guess a connection string -- "
            "set it to the database you intend to migrate."
        )
    return url


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`).

    Useful for reviewing what a deploy would do to production before it does it.
    """
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live connection.

    create_engine rather than engine_from_config: the latter routes the URL
    through alembic.ini, where ConfigParser interpolation would choke on a '%'
    in a password.
    """
    connectable = create_engine(_database_url(), poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

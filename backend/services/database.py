"""
Database connection and query helpers.
Provides SQLAlchemy session management and common database operations.
"""

import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Annotated, Any

import orjson
from fastapi import Depends
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from settings import get_settings

logger = logging.getLogger(__name__)

DATABASE_URL = get_settings().database_url

# Connections are kept and reused, up to 30 per process: opening a new one
# for every request cost more than most requests (docs/load-test.md). Checked
# before use, so one the database closed is replaced, not handed out. SQLite
# (the tests' database) has its own pool, which takes no size.
_POOL = (
    {}
    if DATABASE_URL.startswith("sqlite")
    else {"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}
)

# Integers longer than 64 bits come back from orjson as floats, where the
# standard library keeps them exact. Answers from Kobo are text, so they are
# rare: only text with a run of 19 digits takes the slow path.
_LONG_NUMBER = re.compile(r"\d{19}")


def _json_loads(value: str) -> Any:
    """
    JSON columns, read with orjson: three times faster than the standard
    library, and the data pages read every submission of a survey
    (docs/load-test.md). The same values either way.
    """
    if _LONG_NUMBER.search(value):
        return json.loads(value)
    try:
        return orjson.loads(value)
    except orjson.JSONDecodeError:
        # Refused by orjson and read by the standard library: a lone surrogate.
        return json.loads(value)


engine: Engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,  # Set to True for SQL query logging
    json_deserializer=_json_loads,
    **_POOL,
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


async def get_db() -> AsyncGenerator[Session, None]:
    """
    A request's database session, closed when the request is done:
    `db: DbSession` in a route.

    Routes are plain functions, which FastAPI runs in its worker threads. This
    is async so the session is opened and closed on the event loop instead: a
    close waiting for a free thread, while every thread waits for a connection
    such a session still holds, would stall the API (docs/load-test.md).
    Scripts use SessionLocal() directly.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# A route's database session: `db: DbSession`.
DbSession = Annotated[Session, Depends(get_db)]


def init_db():
    """
    Initialize database connection.
    Can be used to verify connectivity at startup.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError as e:
        logger.error("Database connection failed: %s", e)
        return False

"""
Database connection and query helpers.
Provides SQLAlchemy session management and common database operations.
"""

import logging
import os
from collections.abc import Generator

from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

load_dotenv()

logger = logging.getLogger(__name__)

# Database connection string from environment
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/field_compass"
)

# Create SQLAlchemy engine
engine: Engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,  # Use NullPool for serverless/Cloud Run compatibility
    echo=False,  # Set to True for SQL query logging
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function for FastAPI to get database session.
    FastAPI will handle the context manager automatically.

    Usage in FastAPI:
        @router.get("/endpoint")
        async def endpoint(db: Session = Depends(get_db)):
            # Use db session
            pass
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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

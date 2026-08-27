"""
Pytest configuration and fixtures for backend tests.
"""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import database models and services
from database.models import Base, SurveyConfig

# Use in-memory SQLite for testing (faster than PostgreSQL)
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="function")
def test_db():
    """
    Create a test database session with in-memory SQLite.
    Each test gets a fresh database.
    SQLite doesn't support JSONB, so we map JSONB to JSON for testing.
    """
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Map JSONB to JSON for SQLite compatibility
    @event.listens_for(engine, "connect", propagate=True)
    def set_sqlite_pragma(dbapi_conn, connection_record):
        """Set SQLite pragmas for better compatibility."""
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    # Replace JSONB with JSON for SQLite and UUID with String
    from sqlalchemy import JSON, String, TypeDecorator
    from sqlalchemy.dialects.postgresql import UUID as PostgresUUID

    class JSONBForSQLite(TypeDecorator):
        """JSONB type that uses JSON for SQLite."""

        impl = JSON
        cache_ok = True

        def load_dialect_impl(self, dialect):
            if dialect.name == "sqlite":
                return dialect.type_descriptor(JSON())
            else:
                return dialect.type_descriptor(JSONB())

    class UUIDForSQLite(TypeDecorator):
        """UUID type that uses String for SQLite."""

        impl = String(36)
        cache_ok = True

        def load_dialect_impl(self, dialect):
            if dialect.name == "sqlite":
                return dialect.type_descriptor(String(36))
            else:
                return dialect.type_descriptor(PostgresUUID(as_uuid=True))

        def process_bind_param(self, value, dialect):
            """Convert UUID to string for SQLite."""
            if value is None:
                return None
            if dialect.name == "sqlite":
                return str(value) if not isinstance(value, str) else value
            return value

        def process_result_value(self, value, dialect):
            """Convert string back to UUID for PostgreSQL."""
            if value is None:
                return None
            if dialect.name == "sqlite":
                from uuid import UUID

                return UUID(value) if isinstance(value, str) else value
            return value

    # Replace JSONB and UUID columns for SQLite compatibility

    # Update column types for SQLite compatibility
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSONBForSQLite()
            elif isinstance(column.type, PostgresUUID):
                column.type = UUIDForSQLite()

    # Create all tables
    Base.metadata.create_all(bind=engine)

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_survey_config(test_db):
    """Create a test survey configuration."""
    survey = SurveyConfig(
        survey_id=uuid4(),
        survey_name="Test Survey",
        kobo_asset_id="test_asset_123",
        config_data={
            "core_identifiers": {
                "uuid": "_uuid",
                "enumerator": "enumerator_id",
                "date_interview": "today",
                "start_time": "start",
                "end_time": "end",
            },
            "special_values": {"dk_value": -99, "dk_string_value": "dk"},
            "global_parameters": {
                "data_collection_start_date": "2023-01-01",
                "data_collection_end_date": "2023-12-31",
                "min_survey_duration_minutes": 10,
                "max_survey_duration_minutes": 120,
            },
        },
    )
    test_db.add(survey)
    test_db.commit()
    test_db.refresh(survey)
    return survey


@pytest.fixture
def sample_kobo_submission():
    """Sample Kobo API submission data for testing."""
    return {
        "_id": 1001,
        "_uuid": "test-uuid-001",
        "_submission_time": "2023-10-26T10:00:00Z",
        "end": "2023-10-26T10:15:00Z",
        "_validation_status": {
            "timestamp": 1698321600,
            "uid": "validation_status_approved",
            "by_whom": "test_user",
            "label": "Approved",
        },
        "enumerator_id": "ENUM001",
        "today": "2023-10-26",
        "start": "2023-10-26T10:00:00Z",
        "age": 25,
        "income": 50000,
    }


@pytest.fixture
def sample_kobo_submission_flagged():
    """Sample Kobo API submission with validation status 'Not Approved'."""
    return {
        "_id": 1002,
        "_uuid": "test-uuid-002",
        "_submission_time": "2023-10-26T11:00:00Z",
        "end": "2023-10-26T11:15:00Z",
        "_validation_status": {
            "timestamp": 1698325200,
            "uid": "validation_status_not_approved",
            "by_whom": "test_user",
            "label": "Not Approved",
        },
        "enumerator_id": "ENUM002",
        "today": "2023-10-26",
        "start": "2023-10-26T11:00:00Z",
        "age": 25,
        "income": 50000,
    }

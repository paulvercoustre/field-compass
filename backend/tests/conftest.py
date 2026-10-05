"""
Pytest configuration and fixtures for backend tests.
"""

from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from database.models import Base, SurveyConfig
from tests.sqlite_compat import sqlite_engine


@pytest.fixture(scope="function")
def test_db():
    """
    A session on a fresh in-memory SQLite database (see tests/sqlite_compat.py).
    """
    engine = sqlite_engine()

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

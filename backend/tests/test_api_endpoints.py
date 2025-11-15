"""
Tests for API endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from database.models import Base, SurveyConfig, SubmissionCurrent
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from uuid import uuid4, UUID
from datetime import datetime

# Create test database
TEST_DATABASE_URL = "sqlite:///:memory:"

def create_test_engine():
    """Create a test engine with SQLite-compatible types."""
    from sqlalchemy import TypeDecorator, JSON, String, event
    from sqlalchemy.dialects.postgresql import JSONB, UUID as PostgresUUID
    
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # Map JSONB to JSON and UUID to String for SQLite
    class JSONBForSQLite(TypeDecorator):
        """JSONB type that uses JSON for SQLite."""
        impl = JSON
        cache_ok = True
        
        def load_dialect_impl(self, dialect):
            if dialect.name == 'sqlite':
                return dialect.type_descriptor(JSON())
            else:
                return dialect.type_descriptor(JSONB())
    
    class UUIDForSQLite(TypeDecorator):
        """UUID type that uses String for SQLite."""
        impl = String(36)
        cache_ok = True
        
        def load_dialect_impl(self, dialect):
            if dialect.name == 'sqlite':
                return dialect.type_descriptor(String(36))
            else:
                return dialect.type_descriptor(PostgresUUID(as_uuid=True))
        
        def process_bind_param(self, value, dialect):
            """Convert UUID to string for SQLite."""
            if value is None:
                return None
            if dialect.name == 'sqlite':
                return str(value) if not isinstance(value, str) else value
            return value
        
        def process_result_value(self, value, dialect):
            """Convert string back to UUID for PostgreSQL."""
            if value is None:
                return None
            if dialect.name == 'sqlite':
                from uuid import UUID
                return UUID(value) if isinstance(value, str) else value
            return value
    
    # Replace JSONB and UUID columns for SQLite compatibility
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSONBForSQLite()
            elif isinstance(column.type, PostgresUUID):
                column.type = UUIDForSQLite()
    
    @event.listens_for(engine, "connect", propagate=True)
    def set_sqlite_pragma(dbapi_conn, connection_record):
        """Set SQLite pragmas for better compatibility."""
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    
    return engine

engine = create_test_engine()
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    """Override get_db dependency for testing."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def client():
    """Create a test client with test database."""
    Base.metadata.create_all(bind=engine)
    
    # Import here to avoid circular imports
    from main import app
    from services.database import get_db
    
    # Override the get_db dependency
    app.dependency_overrides[get_db] = override_get_db
    
    with TestClient(app) as test_client:
        yield test_client
    
    # Cleanup
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_survey(client):
    """Create a test survey via API."""
    survey_data = {
        "survey_name": "Test Survey",
        "kobo_asset_id": "test_asset_123",
        "config_data": {
            "core_identifiers": {
                "uuid": "_uuid",
                "enumerator": "enumerator_id"
            },
            "sampling_frame": {
                "sampling_cols": ["district"],
                "frame_data": [
                    {"district": "North", "target": 10},
                    {"district": "South", "target": 15},
                ],
            },
        }
    }
    
    response = client.post("/api/surveys", json=survey_data)
    assert response.status_code == 201
    return response.json()


class TestSurveysEndpoint:
    """Tests for /api/surveys endpoints."""
    
    def test_create_survey(self, client):
        """Test creating a new survey."""
        survey_data = {
            "survey_name": "New Test Survey",
            "kobo_asset_id": "new_asset_456",
            "config_data": {
                "core_identifiers": {
                    "uuid": "_uuid"
                }
            }
        }
        
        response = client.post("/api/surveys", json=survey_data)
        assert response.status_code == 201
        data = response.json()
        assert data["survey_name"] == "New Test Survey"
        assert data["kobo_asset_id"] == "new_asset_456"
    
    def test_get_surveys(self, client, test_survey):
        """Test getting list of surveys."""
        response = client.get("/api/surveys")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert any(s["survey_id"] == test_survey["survey_id"] for s in data)
    
    def test_get_survey_by_id(self, client, test_survey):
        """Test getting a specific survey."""
        survey_id = test_survey["survey_id"]
        response = client.get(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["survey_id"] == survey_id
        assert data["survey_name"] == "Test Survey"
    
    def test_update_survey(self, client, test_survey):
        """Test updating a survey."""
        survey_id = test_survey["survey_id"]
        update_data = {
            "survey_name": "Updated Survey Name",
            "kobo_asset_id": "updated_asset_789"
        }
        
        response = client.put(f"/api/surveys/{survey_id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        assert data["survey_name"] == "Updated Survey Name"
        assert data["kobo_asset_id"] == "updated_asset_789"
    
    def test_delete_survey(self, client, test_survey):
        """Test deleting a survey."""
        survey_id = test_survey["survey_id"]
        response = client.delete(f"/api/surveys/{survey_id}")
        # The endpoint returns 200 with a message, not 204
        assert response.status_code == 200
        
        # Verify it's deleted
        response = client.get(f"/api/surveys/{survey_id}")
        assert response.status_code == 404


class TestSubmissionsEndpoint:
    """Tests for /api/submissions endpoints."""
    
    def test_get_submissions_empty(self, client):
        """Test getting submissions when none exist."""
        response = client.get("/api/submissions")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert len(data["submissions"]) == 0
    
    def test_get_submissions_with_survey_filter(self, client, test_survey):
        """Test filtering submissions by survey_id."""
        survey_id = test_survey["survey_id"]
        response = client.get(f"/api/submissions?survey_id={survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["submissions"], list)
    
    def test_get_submissions_with_status_filter(self, client):
        """Test filtering submissions by qa_status."""
        response = client.get("/api/submissions?qa_status=FLAGGED")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["submissions"], list)
        # All returned submissions should have FLAGGED status
        for sub in data["submissions"]:
            assert sub["qa_status"] == "FLAGGED"


class TestProgressEndpoint:
    """Tests for /api/progress endpoint."""

    def test_progress_includes_sampling_targets_without_data(self, client, test_survey):
        """Progress should list sampling frame targets even with zero submissions."""
        response = client.get(f"/api/progress?survey_id={test_survey['survey_id']}")
        assert response.status_code == 200
        payload = response.json()

        overall = payload["overall"]
        assert overall["target"] == 25
        assert overall["conducted"] == 0

        by_district = payload["byColumn"].get("district", [])
        assert len(by_district) == 2
        north_row = next((row for row in by_district if row["value"] == "North"), None)
        south_row = next((row for row in by_district if row["value"] == "South"), None)
        assert north_row is not None
        assert north_row["target"] == 10
        assert north_row["conducted"] == 0
        assert south_row is not None
        assert south_row["target"] == 15
        assert south_row["conducted"] == 0

        detailed = payload["detailed"]
        assert len(detailed) == 2
        assert any(row["values"]["district"] == "North" and row["target"] == 10 and row["conducted"] == 0 for row in detailed)
        assert any(row["values"]["district"] == "South" and row["target"] == 15 and row["conducted"] == 0 for row in detailed)

    def test_progress_filters_approved_only(self, client, test_survey):
        """Progress endpoint should respect the approved_only flag."""
        survey_uuid = UUID(test_survey["survey_id"])

        with TestingSessionLocal() as db:
            submission_approved = SubmissionCurrent(
                _id=1,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-a"},
                qa_status="APPROVED",
            )
            submission_pending = SubmissionCurrent(
                _id=2,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-b"},
                qa_status="PENDING_APPROVAL",
            )
            db.add_all([submission_approved, submission_pending])
            db.commit()

        response_all = client.get(f"/api/progress?survey_id={test_survey['survey_id']}")
        assert response_all.status_code == 200
        overall_all = response_all.json()["overall"]
        assert overall_all["conducted"] == 2

        response_approved = client.get(
            f"/api/progress?survey_id={test_survey['survey_id']}&approved_only=true"
        )
        assert response_approved.status_code == 200
        overall_approved = response_approved.json()["overall"]
        assert overall_approved["conducted"] == 1


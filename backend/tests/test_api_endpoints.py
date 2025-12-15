"""
Tests for API endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from database.models import Base, SurveyConfig, SubmissionCurrent, ValidationRule, SubmissionHistory
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
    
    def test_delete_survey_cascade_submissions(self, client, test_survey):
        """Test that deleting a survey cascades to delete all submissions."""
        survey_id = test_survey["survey_id"]
        survey_uuid = UUID(survey_id)
        
        # Create test submissions
        with TestingSessionLocal() as db:
            submission1 = SubmissionCurrent(
                _id=1001,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-1", "age": 25},
                qa_status="PENDING_APPROVAL",
            )
            submission2 = SubmissionCurrent(
                _id=1002,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-2", "age": 30},
                qa_status="APPROVED",
            )
            db.add_all([submission1, submission2])
            db.commit()
        
        # Verify submissions exist
        with TestingSessionLocal() as db:
            count = db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey_uuid
            ).count()
            assert count == 2
        
        # Delete the survey
        response = client.delete(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_submissions"] == 2
        
        # Verify submissions are deleted
        with TestingSessionLocal() as db:
            count = db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey_uuid
            ).count()
            assert count == 0
    
    def test_delete_survey_cascade_validation_rules(self, client, test_survey):
        """Test that deleting a survey cascades to delete all validation rules."""
        survey_id = test_survey["survey_id"]
        survey_uuid = UUID(survey_id)
        
        # Create test validation rules
        with TestingSessionLocal() as db:
            rule1 = ValidationRule(
                survey_id=survey_uuid,
                rule_name="test_rule_1",
                rule_data={
                    "issue": "Test issue 1",
                    "check_id": "check1",
                    "check_expression": "age > 100"
                },
                is_active=True,
            )
            rule2 = ValidationRule(
                survey_id=survey_uuid,
                rule_name="test_rule_2",
                rule_data={
                    "issue": "Test issue 2",
                    "check_id": "check2",
                    "check_expression": "income < 0"
                },
                is_active=False,
            )
            db.add_all([rule1, rule2])
            db.commit()
        
        # Verify rules exist
        with TestingSessionLocal() as db:
            count = db.query(ValidationRule).filter(
                ValidationRule.survey_id == survey_uuid
            ).count()
            assert count == 2
        
        # Delete the survey
        response = client.delete(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_validation_rules"] == 2
        
        # Verify rules are deleted
        with TestingSessionLocal() as db:
            count = db.query(ValidationRule).filter(
                ValidationRule.survey_id == survey_uuid
            ).count()
            assert count == 0
    
    def test_delete_survey_cascade_submission_history(self, client, test_survey):
        """Test that deleting a survey cascades to delete submission history records."""
        survey_id = test_survey["survey_id"]
        survey_uuid = UUID(survey_id)
        
        # Create test submission with history
        with TestingSessionLocal() as db:
            submission = SubmissionCurrent(
                _id=2001,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-3", "age": 35},
                qa_status="PENDING_APPROVAL",
            )
            db.add(submission)
            db.commit()
            db.refresh(submission)
            
            # Create history records
            history1 = SubmissionHistory(
                kobo_id=submission._id,
                timestamp=datetime.utcnow(),
                deprecated_uuid="old-uuid-1",
                data_delta=[{"op": "replace", "path": "/age", "value": 35}],
            )
            history2 = SubmissionHistory(
                kobo_id=submission._id,
                timestamp=datetime.utcnow(),
                deprecated_uuid="old-uuid-2",
                data_delta=[{"op": "replace", "path": "/age", "value": 36}],
            )
            db.add_all([history1, history2])
            db.commit()
        
        # Verify history exists
        with TestingSessionLocal() as db:
            count = db.query(SubmissionHistory).filter(
                SubmissionHistory.kobo_id == 2001
            ).count()
            assert count == 2
        
        # Delete the survey
        response = client.delete(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        
        # Verify history is deleted (cascades from submission deletion)
        with TestingSessionLocal() as db:
            count = db.query(SubmissionHistory).filter(
                SubmissionHistory.kobo_id == 2001
            ).count()
            assert count == 0
    
    def test_delete_survey_cascade_all_related_data(self, client, test_survey):
        """Test that deleting a survey deletes all related data in one transaction."""
        survey_id = test_survey["survey_id"]
        survey_uuid = UUID(survey_id)
        
        # Create comprehensive test data
        with TestingSessionLocal() as db:
            # Create submissions
            submission1 = SubmissionCurrent(
                _id=3001,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-4"},
                qa_status="APPROVED",
            )
            submission2 = SubmissionCurrent(
                _id=3002,
                survey_id=survey_uuid,
                _uuid=str(uuid4()),
                _submission_time=datetime.utcnow(),
                end=datetime.utcnow(),
                submission_data={"enumerator_id": "enum-5"},
                qa_status="PENDING_APPROVAL",
            )
            db.add_all([submission1, submission2])
            db.commit()
            db.refresh(submission1)
            
            # Create history for submission1
            history = SubmissionHistory(
                kobo_id=submission1._id,
                timestamp=datetime.utcnow(),
                deprecated_uuid="old-uuid-3",
                data_delta=[{"op": "replace", "path": "/age", "value": 40}],
            )
            db.add(history)
            
            # Create validation rules
            rule1 = ValidationRule(
                survey_id=survey_uuid,
                rule_name="comprehensive_rule_1",
                rule_data={"issue": "Issue 1", "check_id": "c1"},
                is_active=True,
            )
            rule2 = ValidationRule(
                survey_id=survey_uuid,
                rule_name="comprehensive_rule_2",
                rule_data={"issue": "Issue 2", "check_id": "c2"},
                is_active=False,
            )
            db.add_all([rule1, rule2])
            db.commit()
        
        # Verify all data exists
        with TestingSessionLocal() as db:
            sub_count = db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey_uuid
            ).count()
            hist_count = db.query(SubmissionHistory).filter(
                SubmissionHistory.kobo_id == 3001
            ).count()
            rule_count = db.query(ValidationRule).filter(
                ValidationRule.survey_id == survey_uuid
            ).count()
            assert sub_count == 2
            assert hist_count == 1
            assert rule_count == 2
        
        # Delete the survey
        response = client.delete(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_submissions"] == 2
        assert data["deleted_validation_rules"] == 2
        
        # Verify everything is deleted
        with TestingSessionLocal() as db:
            sub_count = db.query(SubmissionCurrent).filter(
                SubmissionCurrent.survey_id == survey_uuid
            ).count()
            hist_count = db.query(SubmissionHistory).filter(
                SubmissionHistory.kobo_id == 3001
            ).count()
            rule_count = db.query(ValidationRule).filter(
                ValidationRule.survey_id == survey_uuid
            ).count()
            survey_exists = db.query(SurveyConfig).filter(
                SurveyConfig.survey_id == survey_uuid
            ).first() is not None
            
            assert sub_count == 0
            assert hist_count == 0
            assert rule_count == 0
            assert not survey_exists
    
    def test_delete_survey_with_no_related_data(self, client, test_survey):
        """Test deleting a survey that has no submissions or rules."""
        survey_id = test_survey["survey_id"]
        
        # Delete the survey (should work even with no related data)
        response = client.delete(f"/api/surveys/{survey_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_submissions"] == 0
        assert data["deleted_validation_rules"] == 0
        
        # Verify survey is deleted
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


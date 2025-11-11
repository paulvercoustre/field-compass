"""
Tests for HFC engine, especially status determination logic.
"""

import pytest
from datetime import datetime, timedelta
from etl.hfc_engine import HFCEngine, QualityIssue
from database.models import SurveyConfig
from uuid import uuid4


class TestDetermineQAStatus:
    """Tests for determine_qa_status method."""
    
    def test_status_with_no_issues_and_approved(self, test_db, test_survey_config):
        """Test status when no HFC issues and Kobo says Approved."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        kobo_status = "Approved"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "APPROVED"
    
    def test_status_with_issues_and_approved(self, test_db, test_survey_config):
        """Test status when HFC finds issues but Kobo says Approved - should be FLAGGED."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = [
            QualityIssue(check="outlier", field="age", value=150, message="Age is an outlier")
        ]
        kobo_status = "Approved"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        # HFC issues take priority over Kobo approval
        assert status == "FLAGGED"
    
    def test_status_with_no_issues_and_rejected(self, test_db, test_survey_config):
        """Test status when no HFC issues but Kobo says Not Approved - should be REJECTED."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        kobo_status = "Not Approved"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "REJECTED"
    
    def test_status_with_issues_and_rejected(self, test_db, test_survey_config):
        """Test status when HFC finds issues and Kobo says Not Approved - should be REJECTED (rejection takes priority)."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = [
            QualityIssue(check="outlier", field="age", value=150, message="Age is an outlier")
        ]
        kobo_status = "Not Approved"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        # Kobo rejection takes priority over HFC issues
        assert status == "REJECTED"
    
    def test_status_with_issues_and_flagged_for_removal(self, test_db, test_survey_config):
        """Test status when Kobo says Flagged for Removal - should be REJECTED."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        kobo_status = "Flagged for Removal"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "REJECTED"
    
    def test_status_with_on_hold(self, test_db, test_survey_config):
        """Test status when Kobo says On Hold - should return None (no change)."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        kobo_status = "On Hold"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status is None  # Should not change status
    
    def test_status_with_no_kobo_status_and_no_issues(self, test_db, test_survey_config):
        """Test status when no Kobo status and no HFC issues - should be PENDING_APPROVAL."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        kobo_status = None
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "PENDING_APPROVAL"
    
    def test_status_with_no_kobo_status_and_issues(self, test_db, test_survey_config):
        """Test status when no Kobo status but HFC finds issues - should be FLAGGED."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = [
            QualityIssue(check="outlier", field="age", value=150, message="Age is an outlier")
        ]
        kobo_status = None
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "FLAGGED"
    
    def test_status_case_insensitive(self, test_db, test_survey_config):
        """Test that status determination is case-insensitive."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = []
        
        # Test various case combinations
        assert engine.determine_qa_status(issues, "APPROVED") == "APPROVED"
        assert engine.determine_qa_status(issues, "approved") == "APPROVED"
        assert engine.determine_qa_status(issues, "Approved") == "APPROVED"
        assert engine.determine_qa_status(issues, "  approved  ") == "APPROVED"  # With whitespace
        
        assert engine.determine_qa_status(issues, "NOT APPROVED") == "REJECTED"
        assert engine.determine_qa_status(issues, "not approved") == "REJECTED"
        assert engine.determine_qa_status(issues, "Not Approved") == "REJECTED"


class TestDurationChecks:
    """Tests for duration check functionality."""
    
    def test_duration_too_short(self, test_db, test_survey_config):
        """Test that duration too short is flagged."""
        engine = HFCEngine(test_db, test_survey_config)
        
        # Create start and end times that are too short (5 minutes)
        # Use "start" and "end" fields from submission_data (not metadata timestamps)
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(minutes=5)
        
        submission_data = {
            "enumerator_id": "enum1", 
            "_uuid": "test-uuid",
            "start": start_time.isoformat(),
            "end": end_time.isoformat()
        }
        issues = engine.run_checks(
            submission_data=submission_data,
            submission_uuid="test-uuid"
        )
        
        # Should have duration_too_short issue (min is 10 minutes in test config)
        duration_issues = [i for i in issues if i.check == "duration_too_short"]
        assert len(duration_issues) == 1
        assert "too short" in duration_issues[0].message.lower()
    
    def test_duration_too_long(self, test_db, test_survey_config):
        """Test that duration too long is flagged."""
        engine = HFCEngine(test_db, test_survey_config)
        
        # Create start and end times that are too long (150 minutes)
        # Use "start" and "end" fields from submission_data (not metadata timestamps)
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(minutes=150)
        
        submission_data = {
            "enumerator_id": "enum1", 
            "_uuid": "test-uuid",
            "start": start_time.isoformat(),
            "end": end_time.isoformat()
        }
        issues = engine.run_checks(
            submission_data=submission_data,
            submission_uuid="test-uuid"
        )
        
        # Should have duration_too_long issue (max is 120 minutes in test config)
        duration_issues = [i for i in issues if i.check == "duration_too_long"]
        assert len(duration_issues) == 1
        assert "too long" in duration_issues[0].message.lower()
    
    def test_duration_within_range(self, test_db, test_survey_config):
        """Test that duration within range doesn't create issues."""
        engine = HFCEngine(test_db, test_survey_config)
        
        # Create start and end times that are within range (30 minutes)
        # Use "start" and "end" fields from submission_data (not metadata timestamps)
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(minutes=30)
        
        submission_data = {
            "enumerator_id": "enum1", 
            "_uuid": "test-uuid",
            "start": start_time.isoformat(),
            "end": end_time.isoformat()
        }
        issues = engine.run_checks(
            submission_data=submission_data,
            submission_uuid="test-uuid"
        )
        
        # Should not have any duration issues
        duration_issues = [i for i in issues if i.check in ["duration_too_short", "duration_too_long"]]
        assert len(duration_issues) == 0



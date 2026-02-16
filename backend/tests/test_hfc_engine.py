"""
Tests for HFC engine, especially status determination logic.
"""

import pytest
from datetime import datetime, timedelta
from etl.hfc_engine import HFCEngine, QualityIssue
from database.models import SurveyConfig, SubmissionCurrent
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
        """Kobo approval should keep status as APPROVED even if HFC finds issues."""
        engine = HFCEngine(test_db, test_survey_config)
        issues = [
            QualityIssue(check="outlier", field="age", value=150, message="Age is an outlier")
        ]
        kobo_status = "Approved"
        
        status = engine.determine_qa_status(issues, kobo_validation_status=kobo_status)
        
        assert status == "APPROVED"
    
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


class TestIncrementalValidation:
    """Tests for incremental validation methods."""
    
    def test_compute_validation_hash_consistency(self, test_db, test_survey_config):
        """Test that hash is consistent for same configuration."""
        engine = HFCEngine(test_db, test_survey_config)
        
        hash1 = engine.compute_validation_hash()
        hash2 = engine.compute_validation_hash()
        
        assert hash1 == hash2
        assert len(hash1) == 16  # Should be 16 characters
    
    def test_compute_validation_hash_changes_with_rules(self, test_db, test_survey_config):
        """Test that hash changes when rules change."""
        from database.models import ValidationRule
        
        engine = HFCEngine(test_db, test_survey_config)
        hash_before = engine.compute_validation_hash()
        
        # Add a new validation rule
        new_rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="Test Rule",
            rule_data={"check_expression": "age > 100", "issue": "Age too high"},
            is_active=True
        )
        test_db.add(new_rule)
        test_db.commit()
        
        hash_after = engine.compute_validation_hash()
        
        assert hash_before != hash_after
    
    def test_needs_validation_never_validated(self, test_db, test_survey_config):
        """Test that submissions never validated need validation."""
        from database.models import SubmissionCurrent
        
        engine = HFCEngine(test_db, test_survey_config)
        current_hash = engine.compute_validation_hash()
        
        # Create submission with no validation timestamp
        submission = SubmissionCurrent(
            _id=999999,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-999",
            _submission_time=datetime.utcnow(),
            end=datetime.utcnow(),
            submission_data={"test": "data"},
            last_validated_at=None,  # Never validated
            validation_rule_hash=None
        )
        test_db.add(submission)
        test_db.commit()
        
        needs_check, reason = engine.needs_validation(submission, current_hash)
        
        assert needs_check is True
        assert reason == "never_validated"
    
    def test_needs_validation_rules_changed(self, test_db, test_survey_config):
        """Test that submissions need revalidation when rules change."""
        from database.models import SubmissionCurrent
        
        engine = HFCEngine(test_db, test_survey_config)
        old_hash = "old_hash_value"
        current_hash = engine.compute_validation_hash()
        
        # Create submission validated with old rule hash
        submission = SubmissionCurrent(
            _id=999998,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-998",
            _submission_time=datetime.utcnow(),
            end=datetime.utcnow(),
            submission_data={"test": "data"},
            last_validated_at=datetime.utcnow(),
            validation_rule_hash=old_hash  # Different from current
        )
        test_db.add(submission)
        test_db.commit()
        
        needs_check, reason = engine.needs_validation(submission, current_hash)
        
        assert needs_check is True
        assert reason == "rules_changed"
    
    def test_needs_validation_submission_edited(self, test_db, test_survey_config):
        """Test that edited submissions need revalidation."""
        from database.models import SubmissionCurrent
        
        engine = HFCEngine(test_db, test_survey_config)
        current_hash = engine.compute_validation_hash()
        
        # Create submission that was edited after validation
        validated_at = datetime.utcnow() - timedelta(hours=1)
        updated_at = datetime.utcnow()  # More recent than validation
        
        submission = SubmissionCurrent(
            _id=999997,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-997",
            _submission_time=datetime.utcnow(),
            end=datetime.utcnow(),
            submission_data={"test": "data"},
            is_edited=True,  # Marked as edited
            last_validated_at=validated_at,
            validation_rule_hash=current_hash,
            updated_at=updated_at
        )
        test_db.add(submission)
        test_db.commit()
        
        needs_check, reason = engine.needs_validation(submission, current_hash)
        
        assert needs_check is True
        assert reason == "submission_edited"
    
    def test_needs_validation_up_to_date(self, test_db, test_survey_config):
        """Test that up-to-date submissions don't need revalidation."""
        from database.models import SubmissionCurrent
        
        engine = HFCEngine(test_db, test_survey_config)
        current_hash = engine.compute_validation_hash()
        
        # Create submission that was recently validated with current rules
        now = datetime.utcnow()
        
        submission = SubmissionCurrent(
            _id=999996,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-996",
            _submission_time=now,
            end=now,
            submission_data={"test": "data"},
            is_edited=False,
            last_validated_at=now,
            validation_rule_hash=current_hash,
            updated_at=now - timedelta(minutes=1)  # Updated before validation
        )
        test_db.add(submission)
        test_db.commit()
        
        needs_check, reason = engine.needs_validation(submission, current_hash)
        
        assert needs_check is False
        assert reason == "up_to_date"


class TestPrecomputeOutlierStatistics:
    """Tests for precompute_outlier_statistics excluding Not Approved submissions."""

    def test_excludes_not_approved_from_outlier_baseline(self, test_db):
        """Not Approved submissions must not be included in outlier statistics baseline."""
        # Create survey config with outlier detection enabled from the start
        survey_id = uuid4()
        survey_config = SurveyConfig(
            survey_id=survey_id,
            survey_name="Outlier Test Survey",
            kobo_asset_id="outlier_test_asset",
            config_data={
                "core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"},
                "special_values": {"dk_value": -99},
                "global_parameters": {},
                "quality_checks": {
                    "flag_outliers": True,
                    "outlier_variables": ["age"],
                    "outlier_method": "iqr",
                    "outlier_threshold": 1.5,
                },
            },
        )
        test_db.add(survey_config)
        test_db.commit()
        test_db.refresh(survey_config)

        now = datetime.utcnow()

        # Approved: age=30
        sub_approved = SubmissionCurrent(
            _id=900001,
            survey_id=survey_id,
            _uuid="outlier-test-approved",
            _submission_time=now,
            end=now,
            submission_data={"age": 30, "_uuid": "outlier-test-approved"},
            kobo_validation_status="Approved",
        )
        test_db.add(sub_approved)

        # Not Approved: age=1000 (extreme - would heavily skew mean if included)
        sub_not_approved = SubmissionCurrent(
            _id=900002,
            survey_id=survey_id,
            _uuid="outlier-test-not-approved",
            _submission_time=now,
            end=now,
            submission_data={"age": 1000, "_uuid": "outlier-test-not-approved"},
            kobo_validation_status="Not Approved",
        )
        test_db.add(sub_not_approved)

        # Not Reviewed (NULL): age=32
        sub_not_reviewed = SubmissionCurrent(
            _id=900003,
            survey_id=survey_id,
            _uuid="outlier-test-not-reviewed",
            _submission_time=now,
            end=now,
            submission_data={"age": 32, "_uuid": "outlier-test-not-reviewed"},
            kobo_validation_status=None,
        )
        test_db.add(sub_not_reviewed)

        test_db.commit()

        engine = HFCEngine(test_db, survey_config)
        engine.precompute_outlier_statistics()

        stats = engine._outlier_stats_cache.get("age")
        assert stats is not None
        # Baseline should include only Approved (30) and Not Reviewed (32), not Not Approved (1000)
        assert stats["count"] == 2
        assert abs(stats["mean"] - 31.0) < 0.01  # (30 + 32) / 2 = 31


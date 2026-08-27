"""
Tests for data_merger module.
"""

from datetime import datetime

from etl.data_merger import merge_submission, parse_kobo_submission


class TestParseKoboSubmission:
    """Tests for parse_kobo_submission function."""

    def test_parse_basic_submission(self, sample_kobo_submission):
        """Test parsing a basic Kobo submission."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        assert parsed["_id"] == 1001
        assert parsed["_uuid"] == "test-uuid-001"
        assert isinstance(parsed["_submission_time"], datetime)
        assert isinstance(parsed["end"], datetime)
        assert "enumerator_id" in parsed["submission_data"]
        assert "age" in parsed["submission_data"]
        assert "income" in parsed["submission_data"]

    def test_parse_validation_status_dict(self, sample_kobo_submission):
        """Test that validation status dict is correctly extracted."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        # Should extract the 'label' from the validation_status dict
        assert parsed["kobo_validation_status"] == "Approved"

    def test_parse_validation_status_string(self):
        """Test parsing when validation_status is already a string."""
        submission = {
            "_id": 1003,
            "_uuid": "test-uuid-003",
            "_submission_time": "2023-10-26T10:00:00Z",
            "end": "2023-10-26T10:15:00Z",
            "_validation_status": "Approved",  # String instead of dict
            "enumerator_id": "ENUM003",
        }

        parsed = parse_kobo_submission(submission)
        assert parsed["kobo_validation_status"] == "Approved"

    def test_parse_no_validation_status(self):
        """Test parsing when validation_status is missing."""
        submission = {
            "_id": 1004,
            "_uuid": "test-uuid-004",
            "_submission_time": "2023-10-26T10:00:00Z",
            "end": "2023-10-26T10:15:00Z",
            "enumerator_id": "ENUM004",
        }

        parsed = parse_kobo_submission(submission)
        assert parsed["kobo_validation_status"] is None

    def test_parse_metadata_fields_excluded(self, sample_kobo_submission):
        """Test that all fields (including metadata) are included in submission_data."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        # All fields should be included (including metadata)
        # This ensures form fields like 'start' and 'end' are preserved
        assert "_id" in parsed["submission_data"]
        assert "_uuid" in parsed["submission_data"]
        assert "_submission_time" in parsed["submission_data"]
        assert "_validation_status" in parsed["submission_data"]
        assert "end" in parsed["submission_data"]  # Important: form field 'end' is preserved

        # Regular data fields should be in submission_data
        assert "enumerator_id" in parsed["submission_data"]
        assert "age" in parsed["submission_data"]


class TestMergeSubmission:
    """Tests for merge_submission function."""

    def test_create_new_submission(self, test_db, test_survey_config, sample_kobo_submission):
        """Test creating a new submission."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        submission, history, is_new = merge_submission(
            test_db,
            parsed,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
        )

        assert is_new is True
        assert history is None
        assert submission._id == 1001
        assert submission.survey_id == test_survey_config.survey_id
        assert submission.kobo_validation_status == "Approved"
        assert (
            submission.kobo_edit_url
            == f"https://kf.kobotoolbox.org/#/forms/{test_survey_config.kobo_asset_id}/data/table"
        )
        assert submission.qa_status == "PENDING_APPROVAL"  # Will be updated by HFC engine

    def test_update_existing_submission(self, test_db, test_survey_config, sample_kobo_submission):
        """Test updating an existing submission with edit detection."""
        # Create initial submission
        parsed = parse_kobo_submission(sample_kobo_submission)
        submission1, _, _ = merge_submission(
            test_db,
            parsed,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
            kobo_data=sample_kobo_submission,
        )

        # Refresh to get the actual stored datetime (might be timezone-naive from SQLite)
        test_db.refresh(submission1)

        # Update with new data (simulate edit) - change UUID and add deprecatedID
        updated_submission = sample_kobo_submission.copy()
        old_uuid = updated_submission["_uuid"]
        new_uuid = "test-uuid-001-edited"  # New UUID after edit
        updated_submission["_uuid"] = new_uuid
        updated_submission["age"] = 26  # Changed value

        # Add deprecatedID to indicate edit (this is how Kobo marks edited submissions)
        updated_submission["meta"] = {
            "deprecatedID": f"uuid:{old_uuid}",
            "instanceID": f"uuid:{new_uuid}",
            "rootUuid": f"uuid:{old_uuid}",
        }

        parsed2 = parse_kobo_submission(updated_submission)
        submission2, history, is_new = merge_submission(
            test_db,
            parsed2,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
            kobo_data=updated_submission,  # Pass raw data for deprecatedID detection
        )

        assert is_new is False
        assert submission2._id == submission1._id  # Same submission
        assert submission2.is_edited is True  # Should be marked as edited
        assert submission2._uuid == new_uuid  # UUID should be updated
        assert history is not None  # History record should be created
        assert history.deprecated_uuid == old_uuid  # History should contain old UUID

    def test_kobo_edit_url_construction(self, test_db, test_survey_config, sample_kobo_submission):
        """Test that Kobo edit URL is constructed correctly."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        submission, _, _ = merge_submission(
            test_db,
            parsed,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
        )

        expected_url = (
            f"https://kf.kobotoolbox.org/#/forms/{test_survey_config.kobo_asset_id}/data/table"
        )
        assert submission.kobo_edit_url == expected_url

    def test_kobo_edit_url_none_when_no_asset_id(
        self, test_db, test_survey_config, sample_kobo_submission
    ):
        """Test that kobo_edit_url is None when kobo_asset_id is not provided."""
        parsed = parse_kobo_submission(sample_kobo_submission)

        submission, _, _ = merge_submission(
            test_db,
            parsed,
            str(test_survey_config.survey_id),
            kobo_asset_id=None,  # No asset ID
        )
        assert submission.kobo_edit_url is None


class TestIncrementalValidationIntegration:
    """Integration tests for incremental validation and is_edited fix."""

    def test_is_edited_reset_on_reimport_without_edit(
        self, test_db, test_survey_config, sample_kobo_submission
    ):
        """Test that is_edited flag is reset when reimporting without deprecatedID."""
        from etl.data_merger import merge_submission, parse_kobo_submission

        # Step 1: Import submission with edit marker
        edited_sub = sample_kobo_submission.copy()
        edited_sub["meta"] = {"deprecatedID": "uuid:old-uuid"}

        parsed1 = parse_kobo_submission(edited_sub)
        submission1, _, _ = merge_submission(
            test_db,
            parsed1,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
            kobo_data=edited_sub,
        )

        assert submission1.is_edited is True

        # Step 2: Reimport same submission WITHOUT edit marker
        clean_sub = sample_kobo_submission.copy()
        # No meta/deprecatedID field

        parsed2 = parse_kobo_submission(clean_sub)
        submission2, _, _ = merge_submission(
            test_db,
            parsed2,
            str(test_survey_config.survey_id),
            kobo_asset_id=test_survey_config.kobo_asset_id,
            kobo_data=clean_sub,
        )

        # Same submission object (same _id)
        assert submission2._id == submission1._id
        # is_edited should be reset to False
        assert submission2.is_edited is False

    def test_incremental_validation_skips_unchanged(self, test_db, test_survey_config):
        """Test that incremental validation skips unchanged submissions."""
        from database.models import SubmissionCurrent
        from etl.hfc_engine import HFCEngine

        engine = HFCEngine(test_db, test_survey_config)
        current_hash = engine.compute_validation_hash()

        # Create submission that was just validated
        now = datetime.utcnow()
        submission = SubmissionCurrent(
            _id=888888,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-888",
            _submission_time=now,
            end=now,
            submission_data={"enumerator_id": "E001", "age": 30},
            is_edited=False,
            last_validated_at=now,
            validation_rule_hash=current_hash,
            updated_at=now,
        )
        test_db.add(submission)
        test_db.commit()

        # Check if validation needed
        needs_check, reason = engine.needs_validation(submission, current_hash)

        assert needs_check is False
        assert reason == "up_to_date"

    def test_incremental_validation_runs_on_new_submission(self, test_db, test_survey_config):
        """Test that new submissions (never validated) always get validated."""
        from database.models import SubmissionCurrent
        from etl.hfc_engine import HFCEngine

        engine = HFCEngine(test_db, test_survey_config)
        current_hash = engine.compute_validation_hash()

        # Create new submission without validation
        submission = SubmissionCurrent(
            _id=777777,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-777",
            _submission_time=datetime.utcnow(),
            end=datetime.utcnow(),
            submission_data={"enumerator_id": "E001", "age": 30},
            last_validated_at=None,  # Never validated
            validation_rule_hash=None,
        )
        test_db.add(submission)
        test_db.commit()

        # Check if validation needed
        needs_check, reason = engine.needs_validation(submission, current_hash)

        assert needs_check is True
        assert reason == "never_validated"

    def test_incremental_validation_runs_when_rules_change(self, test_db, test_survey_config):
        """Test that validation runs when rules change."""
        from database.models import SubmissionCurrent, ValidationRule
        from etl.hfc_engine import HFCEngine

        engine = HFCEngine(test_db, test_survey_config)
        old_hash = engine.compute_validation_hash()

        # Create submission validated with old rules
        submission = SubmissionCurrent(
            _id=666666,
            survey_id=test_survey_config.survey_id,
            _uuid="test-uuid-666",
            _submission_time=datetime.utcnow(),
            end=datetime.utcnow(),
            submission_data={"enumerator_id": "E001", "age": 30},
            last_validated_at=datetime.utcnow(),
            validation_rule_hash=old_hash,
        )
        test_db.add(submission)
        test_db.commit()

        # Add new rule (this changes the hash)
        new_rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="New Test Rule",
            rule_data={"check_expression": "age > 150", "issue": "Age extremely high"},
            is_active=True,
        )
        test_db.add(new_rule)
        test_db.commit()

        # Recompute hash (should be different now)
        new_hash = engine.compute_validation_hash()
        assert old_hash != new_hash

        # Check if validation needed
        needs_check, reason = engine.needs_validation(submission, new_hash)

        assert needs_check is True
        assert reason == "rules_changed"

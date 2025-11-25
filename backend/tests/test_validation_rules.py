"""
Tests for validation rule evaluation in HFC engine.
"""

import pytest
from etl.hfc_engine import HFCEngine, QualityIssue
from database.models import SurveyConfig, ValidationRule
from uuid import uuid4


class TestValidationRules:
    """Tests for custom validation rule evaluation."""
    
    def test_string_comparison_rule(self, test_db, test_survey_config):
        """Test rule with string comparison (e.g., consent != "yes")."""
        # Create a validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="consent_check",
            rule_data={
                "check_id": "consent_check",
                "issue": "consent not given",
                "check_expression": 'consent != "yes"',
                "variables_involved": ["consent"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule)
        test_db.commit()
        
        # Create engine
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test with consent = "no" (should trigger rule)
        submission_data = {"consent": "no", "enumerator_id": "enum1", "_uuid": "test-uuid-1"}
        issues = engine.run_checks(submission_data, "test-uuid-1")
        
        # Filter to only consent_check issues (basic checks may also run)
        consent_issues = [i for i in issues if i.check == "consent_check"]
        assert len(consent_issues) == 1
        assert consent_issues[0].message == "consent not given"
        
        # Test with consent = "yes" (should not trigger rule)
        submission_data = {"consent": "yes", "enumerator_id": "enum1", "_uuid": "test-uuid-2"}
        issues = engine.run_checks(submission_data, "test-uuid-2")
        
        # Should only have basic checks, not the consent rule
        consent_issues = [i for i in issues if i.check == "consent_check"]
        assert len(consent_issues) == 0
    
    def test_numeric_comparison_rule(self, test_db, test_survey_config):
        """Test rule with numeric comparison (e.g., age < 18)."""
        # Create a validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="underage_check",
            rule_data={
                "check_id": "underage_check",
                "issue": "respondent is under 18",
                "check_expression": "respondent_age < 18",
                "variables_involved": ["respondent_age"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule)
        test_db.commit()
        
        # Create engine
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test with age = 15 (should trigger rule)
        submission_data = {"respondent_age": 15, "enumerator_id": "enum1", "_uuid": "test-uuid-3"}
        issues = engine.run_checks(submission_data, "test-uuid-3")
        
        underage_issues = [i for i in issues if i.check == "underage_check"]
        assert len(underage_issues) == 1
        assert underage_issues[0].message == "respondent is under 18"
        
        # Test with age = 25 (should not trigger rule)
        submission_data = {"respondent_age": 25, "enumerator_id": "enum1", "_uuid": "test-uuid-4"}
        issues = engine.run_checks(submission_data, "test-uuid-4")
        
        underage_issues = [i for i in issues if i.check == "underage_check"]
        assert len(underage_issues) == 0

    def test_numeric_comparison_rule_with_string_values(self, test_db, test_survey_config):
        """Test rule with numeric comparison using string values (like Kobo API returns)."""
        # Create a validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="string_numeric_check",
            rule_data={
                "check_id": "string_numeric_check",
                "issue": "income is too high",
                "check_expression": "income > 200",
                "variables_involved": ["income"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule)
        test_db.commit()

        # Create engine
        engine = HFCEngine(test_db, test_survey_config)

        # Test with income = "250" (string value, should trigger rule)
        submission_data = {"income": "250", "enumerator_id": "enum1", "_uuid": "test-uuid-string-1"}
        issues = engine.run_checks(submission_data, "test-uuid-string-1")

        income_issues = [i for i in issues if i.check == "string_numeric_check"]
        assert len(income_issues) == 1
        assert income_issues[0].message == "income is too high"

        # Test with income = "150" (string value, should not trigger rule)
        submission_data = {"income": "150", "enumerator_id": "enum1", "_uuid": "test-uuid-string-2"}
        issues = engine.run_checks(submission_data, "test-uuid-string-2")

        income_issues = [i for i in issues if i.check == "string_numeric_check"]
        assert len(income_issues) == 0

        # Test with decimal value as string
        rule2 = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="decimal_string_check",
            rule_data={
                "check_id": "decimal_string_check",
                "issue": "score is too high",
                "check_expression": "score >= 95.5",
                "variables_involved": ["score"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule2)
        test_db.commit()

        # Test with score = "96.2" (string decimal, should trigger rule)
        submission_data = {"score": "96.2", "enumerator_id": "enum1", "_uuid": "test-uuid-decimal-1"}
        issues = engine.run_checks(submission_data, "test-uuid-decimal-1")

        score_issues = [i for i in issues if i.check == "decimal_string_check"]
        assert len(score_issues) == 1
        assert score_issues[0].message == "score is too high"

        # Test with score = "94.8" (string decimal, should not trigger rule)
        submission_data = {"score": "94.8", "enumerator_id": "enum1", "_uuid": "test-uuid-decimal-2"}
        issues = engine.run_checks(submission_data, "test-uuid-decimal-2")

        score_issues = [i for i in issues if i.check == "decimal_string_check"]
        assert len(score_issues) == 0

    def test_rule_with_and_operator(self, test_db, test_survey_config):
        """Test rule with AND operator (e.g., age > 18 & income < 1000)."""
        # Create a validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="complex_check",
            rule_data={
                "check_id": "complex_check",
                "issue": "age and income mismatch",
                "check_expression": 'age > 18 & income < 1000',
                "variables_involved": ["age", "income"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule)
        test_db.commit()
        
        # Create engine
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test with age=20, income=500 (should trigger rule)
        submission_data = {"age": 20, "income": 500, "enumerator_id": "enum1", "_uuid": "test-uuid-5"}
        issues = engine.run_checks(submission_data, "test-uuid-5")
        
        complex_issues = [i for i in issues if i.check == "complex_check"]
        assert len(complex_issues) == 1
        
        # Test with age=20, income=2000 (should not trigger rule)
        submission_data = {"age": 20, "income": 2000, "enumerator_id": "enum1", "_uuid": "test-uuid-6"}
        issues = engine.run_checks(submission_data, "test-uuid-6")
        
        complex_issues = [i for i in issues if i.check == "complex_check"]
        assert len(complex_issues) == 0
    
    def test_rule_with_path_based_field(self, test_db, test_survey_config):
        """Test rule with path-based field name (e.g., module/consent)."""
        # Create a validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="path_based_check",
            rule_data={
                "check_id": "path_based_check",
                "issue": "consent not given",
                "check_expression": 'consent != "yes"',
                "variables_involved": ["consent"],
                "roster_name": None
            },
            is_active=True
        )
        test_db.add(rule)
        test_db.commit()
        
        # Create engine
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test with path-based field name
        submission_data = {"sampling_information/consent": "no", "enumerator_id": "enum1", "_uuid": "test-uuid-7"}
        issues = engine.run_checks(submission_data, "test-uuid-7")
        
        # Should find the field using path-based lookup
        path_issues = [i for i in issues if i.check == "path_based_check"]
        assert len(path_issues) == 1
    
    def test_inactive_rule_not_evaluated(self, test_db, test_survey_config):
        """Test that inactive rules are not evaluated."""
        # Create an inactive validation rule
        rule = ValidationRule(
            survey_id=test_survey_config.survey_id,
            rule_name="inactive_check",
            rule_data={
                "check_id": "inactive_check",
                "issue": "should not trigger",
                "check_expression": 'consent != "yes"',
                "variables_involved": ["consent"],
                "roster_name": None
            },
            is_active=False
        )
        test_db.add(rule)
        test_db.commit()
        
        # Create engine
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test with consent = "no" (should NOT trigger rule because it's inactive)
        submission_data = {"consent": "no", "enumerator_id": "enum1", "_uuid": "test-uuid-8"}
        issues = engine.run_checks(submission_data, "test-uuid-8")
        
        inactive_issues = [i for i in issues if i.check == "inactive_check"]
        assert len(inactive_issues) == 0


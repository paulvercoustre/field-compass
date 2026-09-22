"""Tests for the form linter engine, check packs, and rule adoption."""

from types import SimpleNamespace
from unittest.mock import Mock

from database.models import ValidationRule
from etl.hfc_engine import HFCEngine
from forms.schema import DIALECT_API, load_form_schema
from linter.adopt import adopt_findings
from linter.auto_rules import rule_name_for
from linter.engine import run_lint
from linter.form_source import load_survey_form
from linter.registry import registered_ids
from tests.lint_forms import (
    BROKEN_CALC,
    DK_AND_REFUSED,
    DK_EXCLUSIVE_REFUSED_NOT,
    DK_NOT_EXCLUSIVE,
    GROUPED_API,
    GROUPED_STORED,
    HEALTHY,
    INCONSISTENT_DK,
    LEGACY_STORED,
    MISSING_REQUIRED,
    NO_AUDIT,
    NO_AUDIT_API,
    NO_ENUMERATOR,
    NO_INTERVIEW_DATE,
    ORPHAN_LIST,
    SAMPLING_AS_TEXT,
    TODAY_IN_LABEL_ONLY,
    UNBOUNDED_AGE,
    UNBOUNDED_DATE,
    UNREACHABLE,
    UNREACHABLE_FILTERED,
)


def _ids(report, check_id):
    return [finding.check_id for finding in report.findings if finding.check_id == check_id]


def _finding(report, check_id):
    matches = [finding for finding in report.findings if finding.check_id == check_id]
    assert matches, f"expected {check_id} in {[f.check_id for f in report.findings]}"
    return matches[0]


class TestRegistry:
    def test_checks_register_without_a_manual_list(self):
        ids = registered_ids()
        for check_id in (
            "audit_not_enabled",
            "inconsistent_dk_coding",
            "no_enumerator_field",
            "sampling_var_not_select",
            "no_interview_date",
            "dk_not_exclusive",
            "unbounded_numeric",
            "unbounded_date",
            "missing_required",
            "unreachable_question",
            "orphan_choice_list",
            "broken_calculation",
        ):
            assert check_id in ids

    def test_one_failing_check_does_not_abort_the_run(self):
        from linter.models import RegisteredCheck
        from linter.registry import _CHECKS

        original = _CHECKS["orphan_choice_list"]

        def boom(schema, ctx):
            raise RuntimeError("boom")

        _CHECKS["orphan_choice_list"] = RegisteredCheck(
            check_id=original.check_id,
            severity=original.severity,
            tags=original.tags,
            func=boom,
        )
        try:
            report = run_lint(load_form_schema(HEALTHY))
        finally:
            _CHECKS["orphan_choice_list"] = original

        assert "orphan_choice_list" in report.checks_failed
        assert "no_enumerator_field" in report.checks_run
        assert all(finding.check_id != "orphan_choice_list" for finding in report.findings)

    def test_findings_are_deterministically_ordered(self):
        report = run_lint(load_form_schema(UNBOUNDED_AGE))
        keys = [finding.sort_key() for finding in report.findings]
        assert keys == sorted(keys)


class TestAuditNotEnabled:
    def test_api_dialect_without_audit_is_an_error(self):
        schema = load_form_schema(NO_AUDIT_API)
        assert schema.dialect == DIALECT_API
        assert schema.has_audit is False
        report = run_lint(schema)
        finding = _finding(report, "audit_not_enabled")
        assert finding.severity == "error"
        assert "audit log" in finding.why_it_matters.lower()
        assert "type `audit`" in finding.suggested_fix

    def test_xlsx_without_audit_row_is_not_a_false_error(self):
        # Stored kobo_tool cannot prove absence; see forms.schema._resolve_has_audit.
        report = run_lint(load_form_schema(NO_AUDIT))
        assert _ids(report, "audit_not_enabled") == []

    def test_healthy_form_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "audit_not_enabled") == []


class TestInconsistentDk:
    def test_two_conventions_are_an_error(self):
        report = run_lint(load_form_schema(INCONSISTENT_DK))
        finding = _finding(report, "inconsistent_dk_coding")
        assert finding.severity == "error"
        assert "dk" in finding.message.lower()
        assert "-99" in finding.message
        assert "don't-know rate" in finding.why_it_matters.lower()

    def test_single_convention_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "inconsistent_dk_coding") == []


class TestNoEnumerator:
    def test_missing_enumerator_is_an_error(self):
        report = run_lint(load_form_schema(NO_ENUMERATOR))
        finding = _finding(report, "no_enumerator_field")
        assert finding.severity == "error"
        assert "field team" in finding.why_it_matters.lower()

    def test_enumerator_id_is_recognised(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "no_enumerator_field") == []


class TestSamplingVar:
    def test_text_district_is_a_warning(self):
        report = run_lint(load_form_schema(SAMPLING_AS_TEXT))
        finding = _finding(report, "sampling_var_not_select")
        assert finding.severity == "warning"
        assert finding.question_path == "district"
        assert "select_one" in finding.suggested_fix

    def test_select_district_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "sampling_var_not_select") == []


class TestInterviewDate:
    def test_no_date_is_a_warning(self):
        report = run_lint(load_form_schema(NO_INTERVIEW_DATE))
        finding = _finding(report, "no_interview_date")
        assert finding.severity == "warning"
        assert "weekend" in finding.why_it_matters.lower()

    def test_today_metadata_counts(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "no_interview_date") == []


class TestDkNotExclusive:
    def test_select_multiple_without_constraint(self):
        report = run_lint(load_form_schema(DK_NOT_EXCLUSIVE))
        finding = _finding(report, "dk_not_exclusive")
        assert finding.severity == "error"
        assert "count-selected" in finding.suggested_fix
        assert finding.auto_rule is not None
        assert finding.auto_rule["source"] == "linter"

    def test_constraint_present_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "dk_not_exclusive") == []


class TestUnboundedNumeric:
    def test_age_without_constraint(self):
        report = run_lint(load_form_schema(UNBOUNDED_AGE))
        finding = _finding(report, "unbounded_numeric")
        assert finding.severity == "warning"
        assert (
            "0–120" in finding.message
            or "0-120" in finding.message
            or "120" in finding.suggested_fix
        )
        assert finding.auto_rule["check_expression"] == "age > 120"

    def test_constrained_age_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "unbounded_numeric") == []


class TestUnboundedDate:
    def test_birthdate_without_constraint(self):
        report = run_lint(load_form_schema(UNBOUNDED_DATE))
        finding = _finding(report, "unbounded_date")
        assert finding.suggested_fix == ". <= today()"
        assert finding.auto_rule is not None

    def test_no_false_positive_on_healthy(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "unbounded_date") == []


class TestMissingRequired:
    def test_consent_not_required(self):
        report = run_lint(load_form_schema(MISSING_REQUIRED))
        consent = [
            finding
            for finding in report.findings
            if finding.check_id == "missing_required" and finding.question_path == "consent"
        ]
        assert consent
        assert "required" in consent[0].suggested_fix.lower()

    def test_required_consent_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        # enumerator_id and consent are required on HEALTHY
        consent = [
            f
            for f in report.findings
            if f.check_id == "missing_required" and f.question_path == "consent"
        ]
        assert consent == []


class TestUnreachable:
    def test_relevant_on_missing_choice(self):
        report = run_lint(load_form_schema(UNREACHABLE))
        finding = _finding(report, "unreachable_question")
        assert finding.question_path == "child_age"
        assert "yess" in finding.message

    def test_choice_filter_is_skipped(self):
        report = run_lint(load_form_schema(UNREACHABLE_FILTERED))
        assert _ids(report, "unreachable_question") == []


class TestOrphanAndBroken:
    def test_orphan_list_is_info(self):
        report = run_lint(load_form_schema(ORPHAN_LIST))
        finding = _finding(report, "orphan_choice_list")
        assert finding.severity == "info"
        assert "unused_list" in finding.message

    def test_broken_calculation_is_an_error(self):
        report = run_lint(load_form_schema(BROKEN_CALC))
        finding = _finding(report, "broken_calculation")
        assert finding.severity == "error"
        assert "missing_question" in finding.message

    def test_valid_calculation_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "broken_calculation") == []


class TestAdoptRules:
    def test_generated_rule_evaluates_through_hfc(self, test_db, test_survey_config):
        schema = load_form_schema(UNBOUNDED_AGE)
        report = run_lint(schema)
        finding = _finding(report, "unbounded_numeric")
        rules = adopt_findings(test_db, test_survey_config.survey_id, [finding])
        assert len(rules) == 1
        assert rules[0].rule_name == rule_name_for("unbounded_numeric", "age")
        assert rules[0].rule_data["source"] == "linter"

        engine = HFCEngine(test_db, test_survey_config)
        issues = engine.run_checks({"age": 200, "enumerator_id": "E01", "_uuid": "u1"}, "u1")
        linter_issues = [i for i in issues if i.check.startswith("linter_unbounded_numeric")]
        assert len(linter_issues) == 1

        issues_ok = engine.run_checks({"age": 40, "enumerator_id": "E01", "_uuid": "u2"}, "u2")
        assert [i for i in issues_ok if i.check.startswith("linter_unbounded_numeric")] == []

    def test_adopting_twice_is_a_noop(self, test_db, test_survey_config):
        report = run_lint(load_form_schema(UNBOUNDED_AGE))
        finding = _finding(report, "unbounded_numeric")
        first = adopt_findings(test_db, test_survey_config.survey_id, [finding])
        second = adopt_findings(test_db, test_survey_config.survey_id, [finding])
        assert first[0].rule_id == second[0].rule_id
        count = (
            test_db.query(ValidationRule)
            .filter(ValidationRule.survey_id == test_survey_config.survey_id)
            .count()
        )
        assert count == 1

    def test_dk_not_exclusive_rule_flags_combined_answers(self, test_db, test_survey_config):
        report = run_lint(load_form_schema(DK_NOT_EXCLUSIVE))
        finding = _finding(report, "dk_not_exclusive")
        adopt_findings(test_db, test_survey_config.survey_id, [finding])
        engine = HFCEngine(test_db, test_survey_config)

        combined = engine.run_checks(
            {"foods": "dk rice", "enumerator_id": "E01", "_uuid": "u1"}, "u1"
        )
        assert [i for i in combined if "dk_not_exclusive" in i.check]

        exclusive = engine.run_checks({"foods": "dk", "enumerator_id": "E01", "_uuid": "u2"}, "u2")
        assert [i for i in exclusive if "dk_not_exclusive" in i.check] == []


class TestReviewRegressions:
    def test_dk_refused_and_none_are_one_convention(self):
        report = run_lint(load_form_schema(DK_AND_REFUSED))
        assert _ids(report, "inconsistent_dk_coding") == []

    def test_constraint_on_dk_does_not_cover_refused(self):
        report = run_lint(load_form_schema(DK_EXCLUSIVE_REFUSED_NOT))
        finding = _finding(report, "dk_not_exclusive")
        assert "refused" in finding.message
        assert "'refused'" in finding.suggested_fix

    def test_missing_required_offers_no_rule_that_cannot_fire(self):
        report = run_lint(load_form_schema(MISSING_REQUIRED))
        finding = _finding(report, "missing_required")
        assert finding.auto_rule is None

    def test_today_in_a_label_is_not_an_interview_date(self):
        report = run_lint(load_form_schema(TODAY_IN_LABEL_ONLY))
        assert _ids(report, "no_interview_date") == ["no_interview_date"]

    def test_repeat_reference_is_not_a_broken_calculation(self):
        for payload in (GROUPED_API, GROUPED_STORED):
            report = run_lint(load_form_schema(payload))
            assert _ids(report, "broken_calculation") == []

    def test_legacy_form_skips_logic_checks(self):
        report = run_lint(load_form_schema(LEGACY_STORED), form_logic_missing=True)
        assert report.form_logic_missing is True
        for check_id in ("unbounded_numeric", "unbounded_date", "missing_required"):
            assert _ids(report, check_id) == []
        assert "no_enumerator_field" in report.checks_run
        assert report.as_dict()["form_logic_missing"] is True


class TestLoadSurveyForm:
    def _survey(self, form):
        return SimpleNamespace(config_data={"kobo_tool": form}, kobo_asset_id="aAsset1234567")

    def test_stored_form_with_logic_is_used_as_is(self):
        fetch = Mock()
        result = load_survey_form(self._survey(UNBOUNDED_AGE), fetch)
        assert result.logic_missing is False
        fetch.assert_not_called()

    def test_legacy_form_is_re_read_from_kobo(self):
        fetch = Mock(return_value={"content": GROUPED_API})
        result = load_survey_form(self._survey(LEGACY_STORED), fetch)
        fetch.assert_called_once_with("aAsset1234567")
        assert result.logic_missing is False
        assert result.schema.get("hh_count") is not None

    def test_legacy_form_without_kobo_access_is_flagged(self):
        result = load_survey_form(self._survey(LEGACY_STORED), None)
        assert result.logic_missing is True

    def test_failed_fetch_falls_back_to_flagged_stored_form(self):
        fetch = Mock(side_effect=RuntimeError("down"))
        result = load_survey_form(self._survey(LEGACY_STORED), fetch)
        assert result.logic_missing is True
        assert result.schema.get("age") is not None

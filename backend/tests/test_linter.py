"""Tests for the form linter engine, check packs, and rule adoption."""

from database.models import ValidationRule
from etl.hfc_engine import HFCEngine
from forms.schema import DIALECT_API, Choice, load_form_schema
from linter.adopt import adopt_findings
from linter.auto_rules import rule_name_for
from linter.dk import (
    DONT_KNOW,
    NONE,
    NOT_APPLICABLE,
    REFUSED,
    classify_choice,
    classify_text,
    convention_for,
)
from linter.engine import run_lint
from linter.registry import registered_ids
from tests.lint_forms import (
    BROKEN_CALC,
    CONSENT_GATED,
    CONSENT_UNGATED,
    DK_AND_NONE_NOT_EXCLUSIVE,
    DK_NOT_EXCLUSIVE,
    DK_PREFIXED_CODE,
    HEALTHY,
    INCONSISTENT_DK,
    MISSING_REQUIRED,
    MIXED_SPECIAL_VALUES,
    NO_AUDIT,
    NO_AUDIT_API,
    NO_ENUMERATOR,
    NO_INTERVIEW_DATE,
    ORPHAN_LIST,
    SAMPLING_AS_TEXT,
    TRANSLATED,
    UNBOUNDED_AGE,
    UNBOUNDED_DATE,
    UNREACHABLE,
    UNREACHABLE_FILTERED,
    UNTRANSLATED,
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
            "missing_translations",
            "consent_does_not_gate",
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

    def test_the_healthy_form_reports_nothing(self):
        """Every new check has to leave a well-built form alone."""
        report = run_lint(load_form_schema(HEALTHY))
        assert report.findings == [], [finding.message for finding in report.findings]


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

    def test_different_meanings_are_not_an_inconsistency(self):
        # `dk`, `none` and `no` on one list is three answers, coded once each.
        report = run_lint(load_form_schema(MIXED_SPECIAL_VALUES))
        assert _ids(report, "inconsistent_dk_coding") == []

    def test_prefixed_dk_code_counts_as_a_second_convention(self):
        report = run_lint(load_form_schema(DK_PREFIXED_CODE))
        finding = _finding(report, "inconsistent_dk_coding")
        assert "dk_income" in finding.message
        assert "don't know" in finding.message


class TestSpecialValueClassification:
    def test_keywords_and_numeric_sentinels(self):
        for value, expected in (
            ("dk", DONT_KNOW),
            ("-99", DONT_KNOW),
            ("999", DONT_KNOW),
            ("Don't know", DONT_KNOW),
            ("Ne sais pas", DONT_KNOW),
            ("refused", REFUSED),
            ("Prefer not to say", REFUSED),
            ("n/a", NOT_APPLICABLE),
            ("Not applicable", NOT_APPLICABLE),
            ("none", NONE),
            ("None of the above", NONE),
        ):
            assert classify_text(value) == expected, value

    def test_the_code_can_be_glued_to_a_question_name(self):
        assert classify_text("dk_smtg") == DONT_KNOW
        assert classify_text("hh_size_dk") == DONT_KNOW
        assert classify_text("income_na") == NOT_APPLICABLE

    def test_typos_still_classify(self):
        assert classify_text("refusd") == REFUSED
        assert classify_text("dont knwo") == DONT_KNOW
        assert classify_text("nothng") == NONE

    def test_real_answers_are_left_alone(self):
        for value in (
            "yes",
            "no",
            "other",
            "maize",
            "refugee",
            "nine",
            "never",
            "no_school",
            "not_at_all",
            # Short codes only count on their own or on a token edge, or these
            # would read as not-applicable.
            "national",
            "nap_time",
            "1",
            "0",
        ):
            assert classify_text(value) is None, value

    def test_a_label_only_match_still_reports_the_stored_code(self):
        choice = Choice(list_name="yn", name="3", label={"en": "Don't know"}, raw={})
        assert classify_choice(choice) == DONT_KNOW
        assert convention_for(choice) == "3"


class TestMissingTranslations:
    def test_untranslated_rows_are_a_warning(self):
        report = run_lint(load_form_schema(UNTRANSLATED))
        finding = _finding(report, "missing_translations")
        assert finding.severity == "warning"
        assert "French (fr)" in finding.message
        assert "1 question and 1 answer option" in finding.message
        assert "age" in finding.suggested_fix
        assert "yn/no" in finding.suggested_fix

    def test_a_fully_translated_form_is_silent(self):
        report = run_lint(load_form_schema(TRANSLATED))
        assert _ids(report, "missing_translations") == []

    def test_a_single_language_form_is_silent(self):
        report = run_lint(load_form_schema(HEALTHY))
        assert _ids(report, "missing_translations") == []


class TestConsentGating:
    def test_ungated_consent_is_an_error(self):
        report = run_lint(load_form_schema(CONSENT_UNGATED))
        finding = _finding(report, "consent_does_not_gate")
        assert finding.severity == "error"
        assert finding.question_path == "consent"
        assert "full_name" in finding.message
        assert "relevant" in finding.suggested_fix

    def test_gated_consent_is_silent(self):
        report = run_lint(load_form_schema(CONSENT_GATED))
        assert _ids(report, "consent_does_not_gate") == []


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

    def test_every_exclusive_option_is_covered_at_once(self):
        report = run_lint(load_form_schema(DK_AND_NONE_NOT_EXCLUSIVE))
        finding = _finding(report, "dk_not_exclusive")
        assert "don't know" in finding.message
        assert "none" in finding.message
        assert "selected(., 'dk') or selected(., 'none')" in finding.suggested_fix


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

    def test_one_adopted_rule_covers_dk_and_none(self, test_db, test_survey_config):
        report = run_lint(load_form_schema(DK_AND_NONE_NOT_EXCLUSIVE))
        finding = _finding(report, "dk_not_exclusive")
        assert len(adopt_findings(test_db, test_survey_config.survey_id, [finding])) == 1
        engine = HFCEngine(test_db, test_survey_config)

        for index, answer in enumerate(("dk rice", "rice none")):
            uuid = f"u{index}"
            issues = engine.run_checks(
                {"foods": answer, "enumerator_id": "E01", "_uuid": uuid}, uuid
            )
            assert [i for i in issues if "dk_not_exclusive" in i.check], answer

        clean = engine.run_checks({"foods": "none", "enumerator_id": "E01", "_uuid": "ok"}, "ok")
        assert [i for i in clean if "dk_not_exclusive" in i.check] == []

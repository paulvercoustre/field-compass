"""Cognitive pretest: structural walk plus a stubbed agent."""

from forms.schema import load_form_schema
from linter.pretest import compact_form, run_pretest, structural_pretest
from tests.lint_forms import (
    CONSENT_GATED,
    CONSENT_UNGATED,
    GROUPED_API,
    GROUPED_STORED,
    HEALTHY,
    LEGACY_STORED,
)


class FakeAgent:
    def is_available(self):
        return True

    def pretest_instrument(self, form, profiles):
        assert form, "agent must receive a compact form"
        assert profiles
        return [
            {
                "check_id": "pretest_double_barrelled",
                "severity": "warning",
                "question_path": form[0]["path"],
                "profile": "household_no_children",
                "message": "This item asks two things at once.",
                "why_it_matters": "The respondent cannot answer only one part.",
            }
        ]


class TestStructuralPretest:
    def test_ungated_consent_is_an_error(self):
        findings = structural_pretest(load_form_schema(CONSENT_UNGATED))
        assert findings
        assert findings[0].check_id == "pretest_consent_does_not_gate"
        assert findings[0].profile == "consent_refused"
        assert "full_name" in findings[0].message

    def test_gated_consent_is_silent(self):
        findings = structural_pretest(load_form_schema(CONSENT_GATED))
        assert findings == []

    def test_consent_on_the_enclosing_group_gates(self):
        for payload in (GROUPED_API, GROUPED_STORED):
            assert structural_pretest(load_form_schema(payload)) == []

    def test_legacy_form_skips_both_walks(self):
        agent = FakeAgent()
        report = run_pretest(
            load_form_schema(LEGACY_STORED), use_agent=True, agent=agent, form_logic_missing=True
        )
        assert report.findings == []
        assert report.agent_ran is False
        assert report.as_dict()["form_logic_missing"] is True


class TestRunPretest:
    def test_agent_findings_are_merged(self):
        report = run_pretest(load_form_schema(CONSENT_UNGATED), use_agent=True, agent=FakeAgent())
        sources = {finding.source for finding in report.findings}
        assert "structural" in sources
        assert "agent" in sources
        assert report.agent_ran is True
        assert report.agent_error is None

    def test_agent_can_be_skipped(self):
        report = run_pretest(load_form_schema(HEALTHY), use_agent=False)
        assert report.agent_ran is False
        assert all(finding.source == "structural" for finding in report.findings)

    def test_compact_form_is_schema_only(self):
        rows = compact_form(load_form_schema(HEALTHY))
        assert rows
        for row in rows:
            assert "label" in row and "type" in row
            assert "value" not in row
            assert "answer" not in row

"""
Tests for optional core identifiers.

A survey may be configured before its form is final, and some real forms have
no enumerator question at all. The rule under test throughout: never
substitute a value the user did not choose.
"""

import pytest

from services.survey_config import (
    CAPABILITY_DATE_CHECKS,
    CAPABILITY_ENUMERATOR_FILTER,
    CAPABILITY_ENUMERATOR_PERFORMANCE,
    get_core_identifier,
    get_enumerator_field,
    unavailable_capabilities,
)


class TestGetCoreIdentifier:
    """Reading a core identifier without inventing one."""

    def test_returns_the_configured_value(self):
        config = {"core_identifiers": {"enumerator": "intro/interviewer_code"}}

        assert get_enumerator_field(config) == "intro/interviewer_code"

    @pytest.mark.parametrize(
        "config",
        [
            None,
            {},
            {"core_identifiers": None},
            {"core_identifiers": {}},
            {"core_identifiers": {"enumerator": None}},
        ],
    )
    def test_absent_configuration_returns_none(self, config):
        """Never fall back to `enumerator_id` -- that field may not exist."""
        assert get_enumerator_field(config) is None

    @pytest.mark.parametrize("value", ["", "   ", "\t"])
    def test_blank_counts_as_unset(self, value):
        """Clearing the field in the UI stores an empty string; same meaning."""
        assert get_enumerator_field({"core_identifiers": {"enumerator": value}}) is None

    def test_surrounding_whitespace_is_stripped(self):
        config = {"core_identifiers": {"enumerator": "  enum_id  "}}

        assert get_enumerator_field(config) == "enum_id"

    def test_reads_any_identifier_by_name(self):
        config = {"core_identifiers": {"date_interview": "survey_date"}}

        assert get_core_identifier(config, "date_interview") == "survey_date"
        assert get_core_identifier(config, "start_time") is None


class TestUnavailableCapabilities:
    """What the client is told when a setting is missing."""

    def test_nothing_unavailable_when_fully_configured(self):
        config = {"core_identifiers": {"enumerator": "enum_id", "date_interview": "today"}}

        assert unavailable_capabilities(config) == []

    def test_missing_enumerator_disables_performance_and_filter(self):
        config = {"core_identifiers": {"date_interview": "today"}}

        capabilities = {item["capability"] for item in unavailable_capabilities(config)}

        assert capabilities == {CAPABILITY_ENUMERATOR_PERFORMANCE, CAPABILITY_ENUMERATOR_FILTER}

    def test_missing_date_disables_date_checks(self):
        config = {"core_identifiers": {"enumerator": "enum_id"}}

        capabilities = {item["capability"] for item in unavailable_capabilities(config)}

        assert capabilities == {CAPABILITY_DATE_CHECKS}

    def test_each_entry_names_the_setting_to_fix(self):
        """The client deep-links to the setting, so it has to be identified."""
        items = unavailable_capabilities({"core_identifiers": {}})

        assert items, "expected capabilities to be reported as unavailable"
        for item in items:
            assert item["missing_setting"].startswith("core_identifiers.")
            assert item["reason"]
            assert item["capability"]

    def test_empty_config_reports_every_dependent_capability(self):
        capabilities = {item["capability"] for item in unavailable_capabilities(None)}

        assert capabilities == {
            CAPABILITY_ENUMERATOR_PERFORMANCE,
            CAPABILITY_ENUMERATOR_FILTER,
            CAPABILITY_DATE_CHECKS,
        }

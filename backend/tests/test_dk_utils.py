"""
Tests for "don't know" token parsing and matching.

The shape of `dk_string_value` changed from one string to a list of them, and
both shapes have to keep working: configs written before the change are not
rewritten, so the single-string form stays live indefinitely.
"""

from etl.dk_utils import (
    build_eligible_dk_question_index,
    compute_dk_metrics,
    dk_string_tokens,
    is_dk_value,
)


class TestDkStringTokens:
    def test_reads_a_stored_single_string(self):
        """Configs written before this was a list must keep counting."""
        assert dk_string_tokens({"dk_string_value": "dk"}) == {"dk"}

    def test_reads_a_list(self):
        assert dk_string_tokens({"dk_string_value": ["dont_know", "dk"]}) == {"dont_know", "dk"}

    def test_normalises_case_and_whitespace(self):
        assert dk_string_tokens({"dk_string_value": [" DK ", "Dont_Know"]}) == {"dk", "dont_know"}

    def test_drops_blanks_and_nulls(self):
        assert dk_string_tokens({"dk_string_value": ["dk", "", "   ", None]}) == {"dk"}

    def test_absent_or_empty_yields_nothing(self):
        assert dk_string_tokens({}) == set()
        assert dk_string_tokens(None) == set()
        assert dk_string_tokens({"dk_string_value": None}) == set()
        assert dk_string_tokens({"dk_string_value": []}) == set()


class TestIsDkValue:
    tokens = {"dont_know", "dk"}

    def test_matches_any_configured_string(self):
        assert is_dk_value("dont_know", -99, self.tokens)
        assert is_dk_value("dk", -99, self.tokens)

    def test_matches_regardless_of_case(self):
        """The enumerator screen used a raw `==` and missed these."""
        assert is_dk_value("DK", -99, self.tokens)
        assert is_dk_value(" Dont_Know ", -99, self.tokens)

    def test_matches_inside_a_select_multiple_answer(self):
        assert is_dk_value("option_a dk option_b", -99, self.tokens)

    def test_matches_the_numeric_code_as_number_or_text(self):
        assert is_dk_value(-99, -99, self.tokens)
        assert is_dk_value("-99", -99, self.tokens)

    def test_does_not_match_a_substring(self):
        """`dkother` is a different answer option, not a don't-know."""
        assert not is_dk_value("dkother", -99, self.tokens)
        assert not is_dk_value("no_dk", -99, self.tokens)

    def test_ordinary_answers_are_not_dk(self):
        assert not is_dk_value("yes", -99, self.tokens)
        assert not is_dk_value(None, -99, self.tokens)
        assert not is_dk_value(5, -99, self.tokens)

    def test_nothing_configured_counts_nothing(self):
        assert not is_dk_value("dk", None, set())

    def test_list_values(self):
        assert is_dk_value(["yes", "dk"], -99, self.tokens)
        assert not is_dk_value(["yes", "no"], -99, self.tokens)


class TestMultipleValuesEndToEnd:
    """A form coding the same answer two ways counts both."""

    config = {
        "kobo_tool": {
            "survey": [
                {"name": "q_income", "type": "integer"},
                {"name": "q_crop", "type": "select_one crops"},
            ],
            "choices": [
                {"list_name": "crops", "name": "maize"},
                {"list_name": "crops", "name": "dont_know"},
            ],
        },
        "special_values": {"dk_value": -99, "dk_string_value": ["dont_know", "dk"]},
    }

    def test_both_codings_counted(self):
        index = build_eligible_dk_question_index(self.config)
        assert "q_crop" in index.eligible_question_names

        dk_count, eligible, pct = compute_dk_metrics(
            {"q_income": -99, "q_crop": "dont_know"},
            index,
            self.config["special_values"],
        )
        assert (dk_count, eligible, pct) == (2, 2, 100.0)

    def test_a_real_answer_is_not_counted(self):
        index = build_eligible_dk_question_index(self.config)
        dk_count, eligible, _ = compute_dk_metrics(
            {"q_income": 400, "q_crop": "maize"},
            index,
            self.config["special_values"],
        )
        assert (dk_count, eligible) == (0, 2)

    def test_single_string_config_still_counts(self):
        """The same survey, stored the old way."""
        legacy = {
            **self.config,
            "special_values": {"dk_value": -99, "dk_string_value": "dont_know"},
        }
        index = build_eligible_dk_question_index(legacy)
        dk_count, eligible, _ = compute_dk_metrics(
            {"q_income": 400, "q_crop": "dont_know"}, index, legacy["special_values"]
        )
        assert (dk_count, eligible) == (1, 2)

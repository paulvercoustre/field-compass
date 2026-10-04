"""
Tests for "don't know" token parsing and matching.

The shape of `dk_string_value` changed from one string to a list of them, and
both shapes have to keep working: configs written before the change are not
rewritten, so the single-string form stays live indefinitely.
"""

from etl.dk_utils import (
    build_eligible_dk_question_index,
    compute_dk_metrics,
    describe_dk_codes,
    describe_dk_strings,
    dk_codes_fingerprint,
    dk_numeric_codes,
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
        assert is_dk_value("dont_know", [-99], self.tokens)
        assert is_dk_value("dk", [-99], self.tokens)

    def test_matches_regardless_of_case(self):
        """The enumerator screen used a raw `==` and missed these."""
        assert is_dk_value("DK", [-99], self.tokens)
        assert is_dk_value(" Dont_Know ", [-99], self.tokens)

    def test_matches_inside_a_select_multiple_answer(self):
        assert is_dk_value("option_a dk option_b", [-99], self.tokens)

    def test_matches_the_numeric_code_as_number_or_text(self):
        assert is_dk_value(-99, [-99], self.tokens)
        assert is_dk_value("-99", [-99], self.tokens)

    def test_matches_any_of_several_numeric_codes(self):
        """Modules from different teams can code DK as both -99 and -999."""
        assert is_dk_value(-99, [-99, -999], set())
        assert is_dk_value(-999.0, [-99, -999], set())
        assert is_dk_value("-999", [-99, -999], set())
        assert not is_dk_value(-98, [-99, -999], set())

    def test_no_numeric_code_counts_no_number(self):
        assert not is_dk_value(-99, [], set())
        assert not is_dk_value("-99", [], self.tokens)

    def test_does_not_match_a_substring(self):
        """`dkother` is a different answer option, not a don't-know."""
        assert not is_dk_value("dkother", [-99], self.tokens)
        assert not is_dk_value("no_dk", [-99], self.tokens)

    def test_ordinary_answers_are_not_dk(self):
        assert not is_dk_value("yes", [-99], self.tokens)
        assert not is_dk_value(None, [-99], self.tokens)
        assert not is_dk_value(5, [-99], self.tokens)

    def test_nothing_configured_counts_nothing(self):
        assert not is_dk_value("dk", None, set())

    def test_list_values(self):
        assert is_dk_value(["yes", "dk"], [-99], self.tokens)
        assert not is_dk_value(["yes", "no"], [-99], self.tokens)

    def test_whole_answer_only_when_not_split(self):
        """Free text mentioning `dk` is a real answer."""
        assert not is_dk_value("call the dk office", [-99], self.tokens, split_multiple=False)
        assert is_dk_value(" DK ", [-99], self.tokens, split_multiple=False)
        assert is_dk_value("-99", [-99], self.tokens, split_multiple=False)


class TestDkNumericCodes:
    def test_reads_a_stored_single_number(self):
        """Configs written before this was a list must keep their code."""
        assert dk_numeric_codes({"dk_value": -99}) == [-99]

    def test_reads_a_list(self):
        assert dk_numeric_codes({"dk_value": [-99, -999]}) == [-99, -999]

    def test_empty_or_null_means_none(self):
        """Optional: a survey can have no numeric DK code at all."""
        assert dk_numeric_codes({"dk_value": []}) == []
        assert dk_numeric_codes({"dk_value": None}) == []

    def test_never_set_keeps_the_old_default(self):
        assert dk_numeric_codes({}) == [-99]
        assert dk_numeric_codes(None) == [-99]

    def test_normalises_text_floats_and_duplicates(self):
        assert dk_numeric_codes({"dk_value": ["-99", -99.0, " -999 ", "abc", True]}) == [-99, -999]

    def test_one_code_fingerprints_as_the_bare_number(self):
        """So surveys keeping one code are not all revalidated by the upgrade."""
        assert dk_codes_fingerprint([-99]) == -99
        assert dk_codes_fingerprint([-999, -99]) == [-999, -99]
        assert dk_codes_fingerprint([]) == []

    def test_describe(self):
        assert describe_dk_codes([-99, -999]) == "-99 or -999"
        assert describe_dk_codes([]) == "(none configured)"


class TestDescribeDkStrings:
    def test_single_string(self):
        assert describe_dk_strings("dk") == '"dk"'

    def test_list(self):
        assert describe_dk_strings(["dont_know", "dk"]) == '"dk" or "dont_know"'

    def test_nothing_configured(self):
        assert describe_dk_strings(None) == "(none configured)"
        assert describe_dk_strings([]) == "(none configured)"


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


class TestQuestionTypes:
    """Which answers are split, and which types count at all."""

    config = {
        "kobo_tool": {
            "survey": [
                {"name": "q_note", "type": "text"},
                {"name": "q_weight", "type": "decimal"},
                {"name": "q_crops", "type": "select_multiple crops"},
            ],
            "choices": [
                {"list_name": "crops", "name": "maize"},
                {"list_name": "crops", "name": "dk"},
            ],
        },
        "special_values": {"dk_value": -99, "dk_string_value": "dk"},
    }

    def test_decimal_is_eligible(self):
        index = build_eligible_dk_question_index(self.config)
        assert "q_weight" in index.eligible_question_names

    def test_decimal_dk_is_counted(self):
        index = build_eligible_dk_question_index(self.config)
        dk_count, eligible, _ = compute_dk_metrics(
            {"q_weight": "-99"}, index, self.config["special_values"]
        )
        assert (dk_count, eligible) == (1, 1)

    def test_text_mentioning_dk_is_not_counted(self):
        index = build_eligible_dk_question_index(self.config)
        dk_count, eligible, _ = compute_dk_metrics(
            {"q_note": "call the dk office"}, index, self.config["special_values"]
        )
        assert (dk_count, eligible) == (0, 1)

    def test_select_multiple_is_still_split(self):
        index = build_eligible_dk_question_index(self.config)
        assert index.select_multiple_names == {"q_crops"}
        dk_count, eligible, _ = compute_dk_metrics(
            {"q_crops": "maize dk"}, index, self.config["special_values"]
        )
        assert (dk_count, eligible) == (1, 1)

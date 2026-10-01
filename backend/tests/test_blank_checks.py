"""
Rules that flag a question left blank: `is_empty(x)` / `is_not_empty(x)`.

Kobo leaves an unanswered question out of the submission, and does the same
for one its skip logic hid. A blank check has to fire on the first and stay
quiet on the second, so these tests are mostly about that line.
"""

from copy import deepcopy

from database.models import ValidationRule
from etl.hfc_engine import HFCEngine, blank_checked_only
from etl.relevance import evaluate
from tests.lint_forms import _q, form

FORM = form(
    _q("select_one yn", "consent"),
    _q("text", "comments"),
    _q("text", "why_no", relevant="${consent} = 'no'"),
    _q("integer", "age", relevant="${consent} = 'yes'"),
    _q("text", "job", relevant="${age} >= 18"),
    _q("text", "full_name", group_path="main", group_relevant=["${consent} = 'yes'"]),
    _q("text", "odd", relevant="jr:choice-name(${consent}, '${consent}') = 'Yes'"),
    _q("select_one crops", "crop"),
    _q("text", "crop_other", relevant="${crop} = 'other'"),
    _q("text", "member_name", roster_name="hh", group_path="hh"),
)
# The same form as stored before logic columns were kept.
FORM_WITHOUT_LOGIC = form(
    *[
        {k: v for k, v in row.items() if k not in ("relevant", "group_relevant")}
        for row in FORM["survey"]
    ]
)


def _with_form(db, survey, kobo_tool):
    config = deepcopy(survey.config_data)
    config["kobo_tool"] = kobo_tool
    survey.config_data = config
    db.commit()


def _add_rule(db, survey_id, check_id, expression, variables):
    db.add(
        ValidationRule(
            survey_id=survey_id,
            rule_name=check_id,
            rule_data={
                "check_id": check_id,
                "issue": f"{check_id} fired",
                "check_expression": expression,
                "variables_involved": variables,
                "roster_name": None,
            },
            is_active=True,
        )
    )
    db.commit()


def _fired(engine, check_id, answers):
    issues = engine.run_checks({**answers, "enumerator_id": "enum1"}, "uuid-blank")
    return [i for i in issues if i.check == check_id]


class TestBlankCheckedOnly:
    def test_variable_only_inside_the_call(self):
        assert blank_checked_only("is_empty(comments)", ["comments"]) == {"comments"}

    def test_variable_also_compared_is_not(self):
        expression = 'consent == "yes" & is_empty(comments) | comments == "x"'
        assert blank_checked_only(expression, ["consent", "comments"]) == set()

    def test_other_variables_are_untouched(self):
        expression = 'consent == "yes" & is_not_empty(why_no)'
        assert blank_checked_only(expression, ["consent", "why_no"]) == {"why_no"}

    def test_name_inside_a_longer_name_is_not_a_use(self):
        expression = "is_empty(age) & age_months > 3"
        assert blank_checked_only(expression, ["age", "age_months"]) == {"age"}


class TestEvaluate:
    answers = {"consent": "yes", "age": "25", "crops": "maize rice", "other": ""}

    def check(self, expression):
        return evaluate(expression, self.answers.get)

    def test_comparisons(self):
        assert self.check("${consent} = 'yes'") is True
        assert self.check("${consent}='no'") is False
        assert self.check("${age} >= 18 and ${age} != -99") is True

    def test_numbers_sent_as_text_compare_as_numbers(self):
        assert self.check("${age} > 9") is True  # "25" > 9, not "25" > "9"

    def test_functions(self):
        assert self.check("selected(${crops}, 'rice')") is True
        assert self.check("not(selected(${crops}, 'beans'))") is True
        assert self.check("count-selected(${crops}) = 2") is True
        assert self.check("string-length(${other}) = 0") is True
        assert self.check("if(${age} > 18, 'a', 'b') = 'a'") is True

    def test_unanswered_is_the_empty_string(self):
        assert self.check("${missing} = ''") is True
        assert self.check("${missing} != ''") is False

    def test_quoted_equals_sign_is_not_rewritten(self):
        assert self.check("${consent} = 'a=b'") is False

    def test_what_cannot_be_read_is_unknown(self):
        assert self.check("today() > 1") is None
        assert self.check("jr:choice-name(${consent}, '${consent}') = 'Yes'") is None
        assert evaluate("${roster} = 'x'", {"roster": [{"a": 1}]}.get) is None


class TestIsEmptyRule:
    def test_blank_question_without_skip_logic_is_flagged(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "blank", "is_empty(comments)", ["comments"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert len(_fired(engine, "blank", {"consent": "yes"})) == 1
        assert _fired(engine, "blank", {"consent": "yes", "comments": "fine"}) == []

    def test_present_but_empty_string_is_blank(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "blank", "is_empty(comments)", ["comments"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert len(_fired(engine, "blank", {"consent": "yes", "comments": "  "})) == 1

    def test_question_hidden_by_skip_logic_is_not_flagged(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(test_db, test_survey_config.survey_id, "blank", "is_empty(why_no)", ["why_no"])
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"consent": "yes"}) == []
        assert len(_fired(engine, "blank", {"consent": "no"})) == 1

    def test_chained_skip_logic(self, test_db, test_survey_config):
        """`job` shows when age >= 18; age itself only when consent = yes."""
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(test_db, test_survey_config.survey_id, "blank", "is_empty(job)", ["job"])
        engine = HFCEngine(test_db, test_survey_config)

        assert len(_fired(engine, "blank", {"consent": "yes", "age": "30"})) == 1
        assert _fired(engine, "blank", {"consent": "yes", "age": "12"}) == []
        assert _fired(engine, "blank", {"consent": "no"}) == []

    def test_group_skip_logic(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "blank", "is_empty(full_name)", ["full_name"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"consent": "no"}) == []
        assert len(_fired(engine, "blank", {"consent": "yes"})) == 1

    def test_unreadable_skip_logic_is_not_flagged(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(test_db, test_survey_config.survey_id, "blank", "is_empty(odd)", ["odd"])
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"consent": "yes"}) == []

    def test_question_in_a_repeat_is_not_flagged(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "blank", "is_empty(member_name)", ["member_name"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"consent": "yes"}) == []

    def test_dont_know_is_an_answer(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "blank", "is_empty(comments)", ["comments"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"comments": "dk"}) == []

    def test_combined_with_a_condition(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db,
            test_survey_config.survey_id,
            "blank_when_consented",
            'consent == "yes" & is_empty(comments)',
            ["consent", "comments"],
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert len(_fired(engine, "blank_when_consented", {"consent": "yes"})) == 1
        assert _fired(engine, "blank_when_consented", {"consent": "no"}) == []
        # The compared variable still has to be there.
        assert _fired(engine, "blank_when_consented", {}) == []


class TestIsNotEmptyRule:
    def test_answer_where_none_was_expected(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db,
            test_survey_config.survey_id,
            "other_without_other",
            'crop != "other" & is_not_empty(comments)',
            ["crop", "comments"],
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert len(_fired(engine, "other_without_other", {"crop": "maize", "comments": "x"})) == 1
        assert _fired(engine, "other_without_other", {"crop": "maize"}) == []

    def test_hidden_question_is_neither_empty_nor_filled(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _add_rule(
            test_db, test_survey_config.survey_id, "filled", "is_not_empty(why_no)", ["why_no"]
        )
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "filled", {"consent": "yes"}) == []


class TestFormWithoutStoredLogic:
    """Surveys linked before logic columns were stored."""

    def test_without_the_live_form_nothing_is_flagged(self, test_db, test_survey_config):
        """Every question would look asked; better silent than wrong."""
        _with_form(test_db, test_survey_config, FORM_WITHOUT_LOGIC)
        _add_rule(test_db, test_survey_config.survey_id, "blank", "is_empty(why_no)", ["why_no"])
        engine = HFCEngine(test_db, test_survey_config)

        assert _fired(engine, "blank", {"consent": "no"}) == []

    def test_reads_skip_logic_from_the_live_form(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM_WITHOUT_LOGIC)
        _add_rule(test_db, test_survey_config.survey_id, "blank", "is_empty(why_no)", ["why_no"])
        fetched = []

        def fetch_live_form(asset_uid):
            fetched.append(asset_uid)
            return FORM

        engine = HFCEngine(test_db, test_survey_config, fetch_live_form=fetch_live_form)

        assert len(_fired(engine, "blank", {"consent": "no"})) == 1
        assert _fired(engine, "blank", {"consent": "yes"}) == []
        assert fetched == [test_survey_config.kobo_asset_id]  # once per engine


def _enable_empty_check(db, survey, threshold):
    config = deepcopy(survey.config_data)
    config.setdefault("quality_checks", {}).update(
        {"flag_empty_percentage": True, "empty_percentage_threshold": threshold}
    )
    survey.config_data = config
    db.commit()


class TestEmptyPercentage:
    """
    FORM, outside its repeat, with consent = "yes" and age 30, shows: consent,
    comments, age, job, full_name, crop -- six questions (`odd` has skip
    logic this cannot read, so it is left out rather than guessed).
    """

    answers = {"consent": "yes", "age": "30", "crop": "maize"}

    def test_counts_only_questions_that_were_shown(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        engine = HFCEngine(test_db, test_survey_config)

        # comments, job, full_name are empty; why_no and crop_other were hidden.
        assert engine.compute_empty_metrics(self.answers) == (3, 6, 50.0)

    def test_skip_logic_changes_the_denominator(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        engine = HFCEngine(test_db, test_survey_config)

        # consent = no: consent, comments, why_no, crop -- age, job, full_name hidden.
        empty, shown, _ = engine.compute_empty_metrics({"consent": "no", "crop": "maize"})
        assert (empty, shown) == (2, 4)

    def test_flags_above_the_threshold(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _enable_empty_check(test_db, test_survey_config, 40)
        engine = HFCEngine(test_db, test_survey_config)

        issues = engine.run_checks({**self.answers, "enumerator_id": "e1"}, "uuid-empty")
        flagged = [i for i in issues if i.check == "empty_percentage_high"]
        assert len(flagged) == 1
        assert flagged[0].metadata["empty_count"] == 3
        assert flagged[0].metadata["shown_count"] == 6

    def test_quiet_below_the_threshold(self, test_db, test_survey_config):
        _with_form(test_db, test_survey_config, FORM)
        _enable_empty_check(test_db, test_survey_config, 60)
        engine = HFCEngine(test_db, test_survey_config)

        issues = engine.run_checks({**self.answers, "enumerator_id": "e1"}, "uuid-empty")
        assert [i for i in issues if i.check == "empty_percentage_high"] == []

    def test_no_rate_without_skip_logic(self, test_db, test_survey_config):
        """Every hidden question would count as empty."""
        _with_form(test_db, test_survey_config, FORM_WITHOUT_LOGIC)
        engine = HFCEngine(test_db, test_survey_config)

        assert engine.compute_empty_metrics(self.answers) == (0, 0, None)

    def test_hash_unchanged_while_the_check_is_off(self, test_db, test_survey_config):
        """Adding the option must not revalidate every survey's submissions."""
        _with_form(test_db, test_survey_config, FORM)
        before = HFCEngine(test_db, test_survey_config).compute_validation_hash()

        config = deepcopy(test_survey_config.config_data)
        config.setdefault("quality_checks", {}).update(
            {"flag_empty_percentage": False, "empty_percentage_threshold": 10}
        )
        test_survey_config.config_data = config
        test_db.commit()
        assert HFCEngine(test_db, test_survey_config).compute_validation_hash() == before

        _enable_empty_check(test_db, test_survey_config, 40)
        assert HFCEngine(test_db, test_survey_config).compute_validation_hash() != before

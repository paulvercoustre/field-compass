"""
Data quality by question (services/questions.py): how often each question was
asked, answered "don't know" or "Other", flagged and corrected, and which to
look at first.
"""

from datetime import UTC, datetime
from uuid import uuid4

from database.models import SubmissionCurrent, SubmissionHistory, SurveyConfig
from services.questions import by_question

KOBO_TOOL = {
    "survey": [
        {"type": "select_one yesno", "name": "consent", "label": "Consent?"},
        {
            "type": "begin_group",
            "name": "hh",
            "label": "Household",
            "relevant": "${consent} = 'yes'",
        },
        {"type": "integer", "name": "hh_size", "label": "Household size"},
        {"type": "select_one water", "name": "water", "label": "Water source"},
        {
            "type": "text",
            "name": "water_other",
            "label": "Other source",
            "relevant": "${water} = 'other'",
        },
        {"type": "select_one yesno_dk", "name": "remit", "label": "Remittances?"},
        {
            "type": "integer",
            "name": "remit_months",
            "label": "Months",
            "relevant": "${remit} = 'yes'",
        },
        # `maybe` is not on the yesno_dk list: Form check says it can never be shown.
        {
            "type": "integer",
            "name": "school_fees",
            "label": "Fees",
            "relevant": "${remit} = 'maybe'",
        },
        {"type": "end_group", "name": "hh"},
    ],
    "choices": [
        {"list_name": "yesno", "name": "yes", "label": "Yes"},
        {"list_name": "yesno", "name": "no", "label": "No"},
        {"list_name": "yesno_dk", "name": "yes", "label": "Yes"},
        {"list_name": "yesno_dk", "name": "no", "label": "No"},
        {"list_name": "yesno_dk", "name": "dk", "label": "Don't know"},
        {"list_name": "water", "name": "piped", "label": "Piped"},
        {"list_name": "water", "name": "well", "label": "Well"},
        {"list_name": "water", "name": "other", "label": "Other"},
    ],
}

CONFIG = {
    "kobo_tool": KOBO_TOOL,
    "core_identifiers": {"uuid": "_uuid", "enumerator": "enum"},
    "special_values": {"dk_value": -99, "dk_string_value": "dk"},
}


def _sub(_id, enum, answers, issues=()):
    return SubmissionCurrent(
        _id=_id,
        submission_data={"enum": enum, **answers},
        data_quality_issues=list(issues),
    )


def _subs():
    household = [
        (
            "e1",
            {
                "hh/hh_size": "5",
                "hh/water": "other",
                "hh/water_other": "tanker truck",
                "hh/remit": "dk",
            },
        ),
        (
            "e1",
            {
                "hh/hh_size": "-99",
                "hh/water": "other",
                "hh/water_other": "Tanker truck ",
                "hh/remit": "no",
            },
        ),
        ("e2", {"hh/hh_size": "4", "hh/water": "piped", "hh/remit": "yes", "hh/remit_months": "3"}),
        (
            "e2",
            {"hh/hh_size": "6", "hh/water": "other", "hh/water_other": "river", "hh/remit": "dk"},
        ),
        ("e3", {"hh/hh_size": "3", "hh/water": "well", "hh/remit": "no"}),
    ]
    subs = [
        _sub(i + 1, enum, {"consent": "yes", **answers})
        for i, (enum, answers) in enumerate(household)
    ]
    # Six more who declined: the household group was never shown to them.
    subs += [_sub(10 + i, "e3", {"consent": "no"}) for i in range(6)]
    subs[0].data_quality_issues = [{"check": "outlier_hh_size", "field": "hh/hh_size"}]
    subs[1].data_quality_issues = [{"check": "dk_percentage_high", "field": "submission"}]
    return subs


def _history():
    return [
        SubmissionHistory(
            kobo_id=kobo_id,
            timestamp=datetime(2026, 10, day, tzinfo=UTC),
            deprecated_uuid=str(uuid4()),
            data_delta=[
                {"op": "replace", "path": "/hh~1hh_size", "old": "50", "value": "5"},
                {"op": "replace", "path": "/_validation_status", "old": {}, "value": {}},
            ],
        )
        for kobo_id, day in ((1, 2), (3, 3), (4, 4))
    ]


def _rows():
    survey = SurveyConfig(survey_id=uuid4(), config_data=CONFIG)
    response = by_question(_subs(), survey, _history())
    return response, {row.name: row for row in response.questions}


def test_asked_from_the_question_s_condition_and_its_group_s():
    response, rows = _rows()
    assert response.submissions == 11
    assert (rows["consent"].asked, rows["consent"].condition) == (11, None)
    assert (rows["hh_size"].asked, rows["hh_size"].condition) == (5, "consent = 'yes'")
    assert rows["remit_months"].condition == "consent = 'yes' and remit = 'yes'"
    assert rows["hh_size"].group == "Household"
    # 1 of 11: under a condition, and rarely asked.
    assert rows["remit_months"].asked == 1
    assert "rarely_asked" in rows["remit_months"].attention


def test_dont_know_out_of_answers_and_who_records_it():
    _, rows = _rows()
    size = rows["hh_size"]
    assert (size.answered, size.dk, size.dk_enumerators, size.answer_enumerators) == (5, 1, 1, 3)
    assert "many_dk" in size.attention
    assert [(e.id, e.dk, e.answers) for e in size.dk_by_enumerator] == [
        ("e1", 1, 2),
        ("e2", 0, 2),
        ("e3", 0, 1),
    ]
    # Don't-know answers are left out of the numbers.
    assert size.numbers is not None and size.numbers.median == 4.5
    # A choice question allows don't-know only when its list has the option.
    assert (rows["remit"].dk_allowed, rows["remit"].dk) == (True, 2)
    assert rows["water"].dk_allowed is False


def test_other_and_what_it_was_specified_as():
    _, rows = _rows()
    water = rows["water"]
    assert (water.other, water.other_top, water.other_top_count) == (3, "tanker truck", 2)
    assert "often_other" in water.attention
    assert rows["remit"].other is None


def test_findings_corrections_and_form_check():
    response, rows = _rows()
    size = rows["hh_size"]
    # The submission-wide finding belongs to no question.
    assert (size.flagged, size.flagged_by) == (1, {"outlier_hh_size": 1})
    assert size.corrected == 3 and "often_corrected" in size.attention
    assert (
        size.corrections[0].submission_id,
        size.corrections[0].old,
        size.corrections[0].new,
    ) == (
        4,
        "50",
        "5",
    )
    fees = rows["school_fees"]
    assert "unreachable_question" in [f.check_id for f in fees.form_findings]
    assert fees.attention == ["never_shown"]
    assert response.form_findings >= 1


def test_the_ones_to_look_at_first_come_first():
    response, _ = _rows()
    assert response.questions[0].name == "hh_size"
    assert response.questions[-1].attention == []


def test_no_form_stored():
    survey = SurveyConfig(survey_id=uuid4(), config_data={})
    response = by_question(_subs(), survey, [])
    assert response.form_missing and response.questions == []


def test_a_stored_form_s_labels_and_groups():
    """Stored rows carry their group's label, in each language; English by default."""
    stored = {
        "survey": [
            {
                "type": "integer",
                "name": "hh_size",
                "group_path": "hh",
                "label::French (fr)": "Taille du ménage",
                "label::English (en)": "Household size",
                "group_label::French (fr)": "Ménage",
                "group_label::English (en)": "Household",
            }
        ],
        "choices": [],
    }
    survey = SurveyConfig(survey_id=uuid4(), config_data={**CONFIG, "kobo_tool": stored})
    row = by_question(_subs(), survey, []).questions[0]
    assert (row.label, row.group) == ("Household size", "Household")


def test_labels_follow_the_language_chosen_in_settings():
    """The language saved in Settings › Form; until then English, else the form's first."""
    from linter.models import survey_label_column, survey_label_language

    assert survey_label_language(
        {"kobo_tool": {"label_column_survey": "label::French (fr)"}}, []
    ) == ("French (fr)")
    assert survey_label_language({}, ["French (fr)", "English (en)"]) == "English (en)"
    assert survey_label_language({}, ["French (fr)", "Dari (prs)"]) == "French (fr)"
    assert survey_label_language({}, []) is None
    # The same choice as a sheet column, for code reading the stored rows.
    fr_dari = {"survey": [{"label::French (fr)": "A", "label::Dari (prs)": "B"}]}
    assert survey_label_column({"kobo_tool": fr_dari}) == "label::French (fr)"
    assert survey_label_column({}) == "label::English (en)"

    row = {
        "type": "integer",
        "name": "hh_size",
        "label::French (fr)": "Taille du ménage",
        "label::English (en)": "Household size",
    }
    tool = {"survey": [row], "choices": [], "label_column_survey": "label::French (fr)"}
    survey = SurveyConfig(survey_id=uuid4(), config_data={**CONFIG, "kobo_tool": tool})
    assert by_question(_subs(), survey, []).questions[0].label == "Taille du ménage"

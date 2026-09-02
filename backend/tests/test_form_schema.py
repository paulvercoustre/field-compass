"""
Tests for XLSForm schema introspection.

Covers both dialects the loader accepts: the `content` block of the Kobo asset
API, and the sheet rows the frontend stores in `config_data["kobo_tool"]`.
Fixtures below mirror the shapes observed on a live Kobo asset -- notably that
labels are arrays paired with `content.translations`, select lists live in
`select_from_list_name`, and `$xpath` is already group-qualified.
"""

import pytest

from forms import (
    DEFAULT_LANGUAGE,
    DIALECT_API,
    DIALECT_XLSX,
    FormSchema,
    load_form_schema,
    split_type,
    strip_repeat_indices,
)


@pytest.fixture
def api_asset():
    """A Kobo asset payload: groups, a repeat, two languages, audit enabled."""
    return {
        "uid": "aTestAsset123",
        "name": "Test Assessment",
        "content": {
            "translations": ["English (en)", "Dari (da)"],
            "settings": {"version": "20260210", "id_string": "test_form_v1"},
            "survey": [
                {"type": "start", "name": "start", "$xpath": "start", "$kuid": "k1"},
                {"type": "audit", "name": "audit", "$xpath": "audit", "$kuid": "k2"},
                {
                    "type": "begin_group",
                    "name": "sampling_information",
                    "label": ["Sampling Information", "معلومات نمونه"],
                    "$xpath": "sampling_information",
                    "$kuid": "k3",
                },
                {
                    "type": "select_one",
                    "name": "sampling_admin1",
                    "label": ["What is the sampling province?", "نام ولایت"],
                    "select_from_list_name": "admin1",
                    "required": True,
                    "$xpath": "sampling_information/sampling_admin1",
                    "$kuid": "k4",
                },
                {
                    "type": "integer",
                    "name": "respondent_age",
                    "label": ["Respondent age", "سن پاسخ دهنده"],
                    "constraint": "(. >= 18 and . <= 99) or . = -99",
                    "constraint_message": ["Enter 18-99, or -99.", "۱۸ تا ۹۹"],
                    "relevant": "${consent} = 'yes'",
                    "$xpath": "sampling_information/respondent_age",
                    "$kuid": "k5",
                },
                {
                    "type": "note",
                    "name": "info_note",
                    "label": ["Read this", "بخوان"],
                    "$kuid": "k6",
                },
                {"type": "end_group", "$kuid": "k7"},
                {
                    "type": "begin_repeat",
                    "name": "household",
                    "label": ["Household roster", "خانواده"],
                    "$xpath": "household",
                    "$kuid": "k8",
                },
                {
                    "type": "text",
                    "name": "member_name",
                    "label": ["Member name", "نام"],
                    "$xpath": "household/member_name",
                    "$kuid": "k9",
                },
                {"type": "end_repeat", "$kuid": "k10"},
                {
                    "type": "geopoint",
                    "name": "gps",
                    "label": ["Location", "موقعیت"],
                    "$kuid": "k11",
                },
                {
                    "type": "calculate",
                    "name": "livelihood_name",
                    "calculation": "${sampling_admin1}",
                    "$xpath": "livelihood_name",
                    "$kuid": "k12",
                },
            ],
            "choices": [
                {
                    "list_name": "admin1",
                    "name": "AF17",
                    "label": ["Badakhshan", "بدخشان"],
                    "$autovalue": "AF17",
                },
                {"list_name": "admin1", "name": "AF01", "label": ["Kabul", "کابل"]},
            ],
        },
    }


@pytest.fixture
def xlsx_kobo_tool():
    """A stored `kobo_tool`, raw-XLSForm shaped: group markers still present."""
    return {
        "survey": [
            {"type": "start", "name": "start"},
            {
                "type": "begin_group",
                "name": "sampling_information",
                "label::English (en)": "Sampling Information",
                "label::Dari (da)": "معلومات نمونه",
            },
            {
                "type": "select_one admin1",
                "name": "sampling_admin1",
                "label::English (en)": "What is the sampling province?",
                "label::Dari (da)": "نام ولایت",
                "required": "yes",
            },
            {
                "type": "integer",
                "name": "respondent_age",
                "label::English (en)": "Respondent age",
                "constraint": "(. >= 18 and . <= 99) or . = -99",
                "constraint_message::English (en)": "Enter 18-99, or -99.",
                "relevant": "${consent} = 'yes'",
            },
            {"type": "end_group"},
            {
                "type": "begin_repeat",
                "name": "household",
                "label::English (en)": "Household roster",
            },
            {"type": "text", "name": "member_name", "label::English (en)": "Member name"},
            {"type": "end_repeat"},
        ],
        "choices": [
            {
                "list_name": "admin1",
                "name": "AF17",
                "label::English (en)": "Badakhshan",
                "label::Dari (da)": "بدخشان",
            },
            {"list_name": "admin1", "name": "AF01", "label::English (en)": "Kabul"},
        ],
    }


# --------------------------------------------------------------- empty input


@pytest.mark.parametrize(
    "source", [None, {}, [], "", "not a dict", {"content": None}, {"content": {}}]
)
def test_empty_or_malformed_source_returns_empty_schema(source):
    """A survey configured before its form is attached is normal, not an error."""
    schema = load_form_schema(source)

    assert isinstance(schema, FormSchema)
    assert schema.is_empty
    assert not schema
    assert schema.questions == []
    assert schema.choices_by_list == {}
    assert schema.get("anything") is None


def test_survey_rows_that_are_not_dicts_are_skipped():
    schema = load_form_schema({"survey": [None, "junk", 42, {"type": "text", "name": "ok"}]})

    assert [q.name for q in schema.questions] == ["ok"]


def test_choices_missing_list_name_or_value_are_skipped():
    schema = load_form_schema(
        {
            "survey": [],
            "choices": [
                {"name": "orphan"},
                {"list_name": "yn"},
                {"list_name": "yn", "name": "yes"},
            ],
        }
    )

    assert list(schema.choices_by_list) == ["yn"]
    assert [c.name for c in schema.choices_by_list["yn"]] == ["yes"]


# ------------------------------------------------------------------ dialect


def test_api_dialect_detected_from_translations(api_asset):
    assert load_form_schema(api_asset).dialect == DIALECT_API


def test_api_dialect_detected_from_internal_keys_without_translations():
    schema = load_form_schema({"survey": [{"type": "text", "name": "q", "$kuid": "k1"}]})

    assert schema.dialect == DIALECT_API


def test_xlsx_dialect_detected(xlsx_kobo_tool):
    assert load_form_schema(xlsx_kobo_tool).dialect == DIALECT_XLSX


def test_bare_content_block_accepted(api_asset):
    """The loader takes a full asset, or just its content block."""
    from_asset = load_form_schema(api_asset)
    from_content = load_form_schema(api_asset["content"])

    assert from_content.dialect == from_asset.dialect
    assert [q.path for q in from_content.questions] == [q.path for q in from_asset.questions]


# --------------------------------------------------------------------- paths


def test_api_paths_come_from_xpath_verbatim(api_asset):
    """$xpath is what submission_data and audit-log nodes are keyed by."""
    schema = load_form_schema(api_asset)

    assert schema.get("sampling_admin1").path == "sampling_information/sampling_admin1"
    assert schema.get("member_name").path == "household/member_name"
    assert schema.get("audit").path == "audit"


def test_api_path_falls_back_to_walking_when_xpath_absent(api_asset):
    """`note` here carries no $xpath; the group stack still resolves it."""
    schema = load_form_schema(api_asset)

    assert schema.get("info_note").path == "sampling_information/info_note"


def test_xlsx_paths_computed_by_walking_group_markers(xlsx_kobo_tool):
    schema = load_form_schema(xlsx_kobo_tool)

    assert schema.get("sampling_admin1").path == "sampling_information/sampling_admin1"
    assert schema.get("respondent_age").path == "sampling_information/respondent_age"
    assert schema.get("member_name").path == "household/member_name"
    assert schema.get("start").path == "start"


def test_nested_groups_produce_full_paths():
    schema = load_form_schema(
        {
            "survey": [
                {"type": "begin_group", "name": "outer"},
                {"type": "begin_group", "name": "inner"},
                {"type": "text", "name": "deep"},
                {"type": "end_group"},
                {"type": "text", "name": "shallow"},
                {"type": "end_group"},
                {"type": "text", "name": "top"},
            ]
        }
    )

    assert schema.get("deep").path == "outer/inner/deep"
    assert schema.get("deep").group_path == "outer/inner"
    assert schema.get("shallow").path == "outer/shallow"
    assert schema.get("top").path == "top"
    assert schema.get("top").group_path == ""


def test_repeat_name_tracked_and_cleared(xlsx_kobo_tool):
    schema = load_form_schema(xlsx_kobo_tool)

    assert schema.get("member_name").repeat_name == "household"
    assert schema.get("respondent_age").repeat_name is None


def test_nested_repeats_report_innermost():
    schema = load_form_schema(
        {
            "survey": [
                {"type": "begin_repeat", "name": "household"},
                {"type": "begin_repeat", "name": "member"},
                {"type": "text", "name": "illness"},
                {"type": "end_repeat"},
                {"type": "text", "name": "address"},
                {"type": "end_repeat"},
            ]
        }
    )

    assert schema.get("illness").repeat_name == "member"
    assert schema.get("illness").path == "household/member/illness"
    assert schema.get("address").repeat_name == "household"


def test_unbalanced_group_markers_do_not_raise():
    schema = load_form_schema(
        {
            "survey": [
                {"type": "end_group"},
                {"type": "text", "name": "q"},
                {"type": "begin_group", "name": "g"},
            ]
        }
    )

    assert schema.get("q").path == "q"


# -------------------------------------------------------------------- labels


def test_api_labels_paired_with_translations(api_asset):
    label = load_form_schema(api_asset).get("sampling_admin1").label

    assert label == {
        "English (en)": "What is the sampling province?",
        "Dari (da)": "نام ولایت",
    }


def test_xlsx_labels_read_from_columns(xlsx_kobo_tool):
    label = load_form_schema(xlsx_kobo_tool).get("sampling_admin1").label

    assert label == {
        "English (en)": "What is the sampling province?",
        "Dari (da)": "نام ولایت",
    }


def test_languages_discovered_not_hardcoded(api_asset, xlsx_kobo_tool):
    assert load_form_schema(api_asset).languages == ["English (en)", "Dari (da)"]
    assert load_form_schema(xlsx_kobo_tool).languages == ["English (en)", "Dari (da)"]


def test_null_translation_maps_to_default_language():
    schema = load_form_schema(
        {"translations": [None], "survey": [{"type": "text", "name": "q", "label": ["Question"]}]}
    )

    assert schema.languages == [DEFAULT_LANGUAGE]
    assert schema.get("q").label == {DEFAULT_LANGUAGE: "Question"}


def test_bare_label_column_maps_to_default_language():
    schema = load_form_schema({"survey": [{"type": "text", "name": "q", "label": "Question"}]})

    assert schema.get("q").label == {DEFAULT_LANGUAGE: "Question"}


def test_label_for_falls_back_through_language_then_name(api_asset):
    question = load_form_schema(api_asset).get("sampling_admin1")

    assert question.label_for("Dari (da)") == "نام ولایت"
    assert question.label_for("Pashto (pa)") == "What is the sampling province?"
    assert (
        load_form_schema({"survey": [{"type": "text", "name": "bare"}]}).get("bare").label_for()
        == "bare"
    )


def test_constraint_message_normalized_in_both_dialects(api_asset, xlsx_kobo_tool):
    api_msg = load_form_schema(api_asset).get("respondent_age").constraint_message
    xlsx_msg = load_form_schema(xlsx_kobo_tool).get("respondent_age").constraint_message

    assert api_msg["English (en)"] == "Enter 18-99, or -99."
    assert xlsx_msg["English (en)"] == "Enter 18-99, or -99."


def test_choice_labels_normalized_in_both_dialects(api_asset, xlsx_kobo_tool):
    for source in (api_asset, xlsx_kobo_tool):
        choices = load_form_schema(source).choices_by_list["admin1"]
        assert [c.name for c in choices] == ["AF17", "AF01"]
        assert choices[0].label["English (en)"] == "Badakhshan"


# ---------------------------------------------------------------- type split


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("text", ("text", None, None, False)),
        ("integer", ("integer", None, None, False)),
        ("select_one my_list", ("select_one", "my_list", None, False)),
        ("select_multiple my_list", ("select_multiple", "my_list", None, False)),
        ("select_one my_list or_other", ("select_one", "my_list", None, True)),
        ("select_multiple my_list or_other", ("select_multiple", "my_list", None, True)),
        (
            "select_one_from_file districts.csv",
            ("select_one_from_file", None, "districts.csv", False),
        ),
        ("select_multiple_from_file d.csv", ("select_multiple_from_file", None, "d.csv", False)),
        ("rank my_list", ("rank", "my_list", None, False)),
        ("begin_group", ("begin_group", None, None, False)),
        ("begin group", ("begin_group", None, None, False)),
        ("end repeat", ("end_repeat", None, None, False)),
        ("  text  ", ("text", None, None, False)),
        ("", ("", None, None, False)),
        (None, ("", None, None, False)),
    ],
)
def test_split_type(raw, expected):
    assert split_type(raw) == expected


def test_select_list_from_select_from_list_name_on_api(api_asset):
    question = load_form_schema(api_asset).get("sampling_admin1")

    assert question.type == "select_one"
    assert question.list_name == "admin1"


def test_select_list_from_type_string_on_xlsx(xlsx_kobo_tool):
    question = load_form_schema(xlsx_kobo_tool).get("sampling_admin1")

    assert question.type == "select_one"
    assert question.list_name == "admin1"
    assert question.raw_type == "select_one admin1"


def test_from_file_operand_is_not_treated_as_a_choice_list():
    """The old frontend split() turned the filename into a list_name."""
    schema = load_form_schema(
        {"survey": [{"type": "select_one_from_file districts.csv", "name": "district"}]}
    )
    question = schema.get("district")

    assert question.type == "select_one_from_file"
    assert question.list_name is None
    assert question.file_name == "districts.csv"


def test_or_other_flagged_and_stripped_from_list_name():
    schema = load_form_schema({"survey": [{"type": "select_one yn or_other", "name": "q"}]})

    assert schema.get("q").list_name == "yn"
    assert schema.get("q").or_other is True


# --------------------------------------------------------------- completeness


def test_every_row_is_preserved_including_metadata_and_structure(api_asset):
    """The frontend allowlist silently dropped notes, geopoints, audit, groups."""
    schema = load_form_schema(api_asset)
    types = [q.type for q in schema.questions]

    assert len(schema.questions) == len(api_asset["content"]["survey"])
    for expected in (
        "start",
        "audit",
        "note",
        "geopoint",
        "begin_group",
        "end_group",
        "begin_repeat",
        "end_repeat",
        "calculate",
    ):
        assert expected in types


def test_structural_markers_flagged(api_asset):
    schema = load_form_schema(api_asset)

    assert schema.get("sampling_information").is_structural is True
    assert schema.get("respondent_age").is_structural is False


# ---------------------------------------------------------------- has_audit


def test_has_audit_true_when_audit_row_present(api_asset):
    assert load_form_schema(api_asset).has_audit is True


def test_has_audit_false_on_api_when_row_absent(api_asset):
    api_asset["content"]["survey"] = [
        row for row in api_asset["content"]["survey"] if row.get("type") != "audit"
    ]

    assert load_form_schema(api_asset).has_audit is False


def test_has_audit_none_on_xlsx_when_row_absent(xlsx_kobo_tool):
    """
    The frontend parser filters `audit` out before storage, so on the stored
    dialect absence proves nothing. None, never False -- see #32.
    """
    assert load_form_schema(xlsx_kobo_tool).has_audit is None


def test_has_audit_true_on_xlsx_when_row_survived():
    schema = load_form_schema({"survey": [{"type": "audit", "name": "audit"}]})

    assert schema.has_audit is True


# -------------------------------------------------------------------- lookup


def test_get_resolves_by_path_name_and_suffix(api_asset):
    schema = load_form_schema(api_asset)
    expected = schema.get("sampling_information/sampling_admin1")

    assert expected is not None
    assert schema.get("sampling_admin1") is expected
    assert schema.get("  sampling_admin1  ") is expected


def test_get_returns_none_for_unknown_or_blank(api_asset):
    schema = load_form_schema(api_asset)

    assert schema.get("does_not_exist") is None
    assert schema.get("") is None
    assert schema.get(None) is None


def test_get_ignores_nameless_structural_closers(api_asset):
    """end_group rows have no name and must never win a lookup."""
    schema = load_form_schema(api_asset)

    assert schema.get("end_group") is None


def test_iter_questions_filters_by_type(api_asset):
    schema = load_form_schema(api_asset)

    assert [q.name for q in schema.iter_questions("select_one")] == ["sampling_admin1"]
    assert {q.name for q in schema.iter_questions(["integer", "text"])} == {
        "respondent_age",
        "member_name",
    }
    assert len(list(schema.iter_questions())) == len(schema.questions)


def test_choices_for_question(api_asset):
    schema = load_form_schema(api_asset)

    choices = schema.choices_for(schema.get("sampling_admin1"))
    assert [c.name for c in choices] == ["AF17", "AF01"]
    assert schema.choices_for(schema.get("respondent_age")) == []


# ------------------------------------------------------------------ settings


def test_settings_read_from_api_content(api_asset):
    settings = load_form_schema(api_asset).settings

    assert settings["id_string"] == "test_form_v1"
    assert settings["version"] == "20260210"


def test_settings_empty_on_stored_dialect(xlsx_kobo_tool):
    assert load_form_schema(xlsx_kobo_tool).settings == {}


# ------------------------------------------------------------------ required


@pytest.mark.parametrize(
    "value,expected",
    [
        (True, True),
        ("yes", True),
        ("TRUE", True),
        ("1", True),
        (False, False),
        ("no", False),
        ("", False),
        (None, False),
    ],
)
def test_required_normalized_to_bool(value, expected):
    schema = load_form_schema({"survey": [{"type": "text", "name": "q", "required": value}]})

    assert schema.get("q").required is expected


# ------------------------------------------------------------- cross-dialect


def test_both_dialects_agree_on_shared_questions(api_asset, xlsx_kobo_tool):
    """
    The acceptance criterion that matters: the same instrument loaded either
    way describes its questions identically, apart from settings and audit.
    """
    api = load_form_schema(api_asset)
    xlsx = load_form_schema(xlsx_kobo_tool)

    for name in ("sampling_admin1", "respondent_age", "member_name"):
        a, x = api.get(name), xlsx.get(name)
        assert a is not None and x is not None, name
        assert a.path == x.path, name
        assert a.group_path == x.group_path, name
        assert a.repeat_name == x.repeat_name, name
        assert a.type == x.type, name
        assert a.list_name == x.list_name, name
        assert a.required == x.required, name
        assert a.constraint == x.constraint, name
        assert a.relevant == x.relevant, name
        assert a.label["English (en)"] == x.label["English (en)"], name


def test_paths_match_submission_data_keys(api_asset):
    """
    Guards the whole point of the module: paths must line up with how Kobo
    keys submission_data, so downstream lookups stop relying on suffix matching.
    """
    submission_data = {
        "start": "2026-02-10T09:00:00",
        "sampling_information/sampling_admin1": "AF17",
        "sampling_information/respondent_age": 34,
        "household/member_name": "Sample",
    }
    schema = load_form_schema(api_asset)

    for key in submission_data:
        assert schema.get(key) is not None, key
        assert schema.get(key).path == key


# ------------------------------------------------------- repeat instance paths


def test_strip_repeat_indices():
    assert strip_repeat_indices("roster[2]/cost") == "roster/cost"
    assert strip_repeat_indices("a[1]/b[12]/c") == "a/b/c"
    assert strip_repeat_indices("plain/path") == "plain/path"
    assert strip_repeat_indices("") == ""


def test_get_resolves_audit_log_nodes_carrying_repeat_indices():
    """
    Audit-log nodes and ODK XML paths address a specific repeat instance
    (`asset_roster[2]/asset_cost`) while the form defines the question once.
    Observed on a real form whose audit logs use exactly this shape.
    """
    schema = load_form_schema(
        {
            "survey": [
                {"type": "begin_group", "name": "assets_operations"},
                {"type": "begin_repeat", "name": "asset_roster"},
                {"type": "integer", "name": "asset_cost"},
                {"type": "end_repeat"},
                {"type": "end_group"},
            ]
        }
    )

    question = schema.get("assets_operations/asset_roster/asset_cost")
    assert question is not None
    assert question.repeat_name == "asset_roster"

    assert schema.get("assets_operations/asset_roster[1]/asset_cost") is question
    assert schema.get("assets_operations/asset_roster[27]/asset_cost") is question
    assert schema.get("asset_roster[3]/asset_cost") is question


def test_indexless_paths_still_resolve_unchanged(api_asset):
    """The index pass must not perturb ordinary lookups."""
    schema = load_form_schema(api_asset)

    assert schema.get("household/member_name").name == "member_name"
    assert schema.get("member_name").name == "member_name"
    assert schema.get("nope[1]/nothing") is None

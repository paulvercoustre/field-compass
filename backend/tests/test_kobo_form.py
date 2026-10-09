"""
The stored form follows the one in Kobo.

Without this, a survey keeps the copy of its form saved when it was set up:
new questions, notes, group titles and choice columns only arrive when
someone thinks to refresh the form in Settings.
"""

from copy import deepcopy

from etl.pipeline import ETLPipeline
from services.kobo_form import refresh_stored_form

ASSET = {
    "uid": "aForm",
    "content": {
        "translations": ["English (en)", "French (fr)"],
        "survey": [
            {"type": "begin_group", "name": "hh", "label": ["Household", "Ménage"], "$xpath": "hh"},
            {
                "type": "integer",
                "name": "hh_size",
                "label": ["Size", "Taille"],
                "$xpath": "hh/hh_size",
            },
            {
                "type": "note",
                "name": "thanks",
                "label": ["Thank you", "Merci"],
                "$xpath": "hh/thanks",
            },
            {"type": "end_group"},
        ],
        "choices": [],
    },
}


def _rows(survey):
    return {row["name"]: row for row in survey.config_data["kobo_tool"]["survey"]}


def test_a_new_version_replaces_the_stored_rows_and_keeps_the_label_language(
    test_db, test_survey_config
):
    test_survey_config.config_data = {
        **test_survey_config.config_data,
        "kobo_tool": {
            "survey": [{"type": "integer", "name": "hh_size", "label::English (en)": "Size"}],
            "choices": [],
            "label_column_survey": "label::French (fr)",
        },
    }
    test_db.commit()

    assert refresh_stored_form(test_survey_config, lambda uid: ASSET) is True

    rows = _rows(test_survey_config)
    assert rows["hh_size"]["group_label::French (fr)"] == "Ménage"
    assert rows["thanks"]["type"] == "note"
    assert (
        test_survey_config.config_data["kobo_tool"]["label_column_survey"] == "label::French (fr)"
    )
    # The rest of the survey's settings are untouched.
    assert test_survey_config.config_data["core_identifiers"]["enumerator"] == "enumerator_id"


def test_the_same_form_changes_nothing(test_survey_config):
    refresh_stored_form(test_survey_config, lambda uid: ASSET)
    before = deepcopy(test_survey_config.config_data)

    assert refresh_stored_form(test_survey_config, lambda uid: ASSET) is False
    assert test_survey_config.config_data == before


def test_kobo_unreadable_or_formless_keeps_the_stored_form(test_survey_config):
    before = deepcopy(test_survey_config.config_data)

    def unreachable(uid):
        raise RuntimeError("connection refused")

    assert refresh_stored_form(test_survey_config, unreachable) is False
    assert (
        refresh_stored_form(test_survey_config, lambda uid: {"uid": "aForm", "content": {}})
        is False
    )
    assert test_survey_config.config_data == before


def test_an_old_nested_copy_gives_way_to_the_rows(test_survey_config):
    test_survey_config.config_data = {
        **test_survey_config.config_data,
        "kobo_tool": {"content": {"survey": [{"type": "text", "name": "old"}]}},
    }

    refresh_stored_form(test_survey_config, lambda uid: ASSET)

    assert "content" not in test_survey_config.config_data["kobo_tool"]
    assert set(_rows(test_survey_config)) == {"hh_size", "thanks"}


class _Fetcher:
    def get_asset_submissions(self, **_):
        return []

    def get_asset_info(self, asset_uid):
        return ASSET


def test_a_pull_stores_the_form_kobo_has_now(test_db, test_survey_config):
    ETLPipeline(test_db, kobo_fetcher=_Fetcher()).run_pipeline(str(test_survey_config.survey_id))

    test_db.refresh(test_survey_config)
    assert set(_rows(test_survey_config)) == {"hh_size", "thanks"}

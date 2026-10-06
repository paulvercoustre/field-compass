"""services.submission_filters, without a database."""

from types import SimpleNamespace

import pytest

from services.submission_filters import filter_by_answers, parse_list, parse_sampling_filters


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (None, {}),
        ("", {}),
        ("district=north", {"district": ["north"]}),
        (
            " district = north , south ;livelihood=farming",
            {"district": ["north", "south"], "livelihood": ["farming"]},
        ),
        ("district=;novalue;=x", {}),
    ],
)
def test_parse_sampling_filters(text, expected):
    assert parse_sampling_filters(text) == expected


def test_parse_list():
    assert parse_list(" a, b,,c ") == ["a", "b", "c"]
    assert parse_list(None) == []


def _subs(*answers):
    return [SimpleNamespace(name=i, submission_data=data) for i, data in enumerate(answers)]


def _names(subs, **kwargs):
    options = {
        "enumerator_field": None,
        "enumerators": [],
        "sampling_filters": {},
        "sampling_cols": ["district"],
    }
    return [s.name for s in filter_by_answers(subs, **{**options, **kwargs})]


def test_a_missing_or_blank_answer_never_matches():
    subs = _subs({"district": "north"}, {}, {"district": ""}, {"district": None}, None)
    assert _names(subs, sampling_filters={"district": ["north", "None", ""]}) == [0]


def test_answers_compare_as_text_so_zero_can_match():
    assert _names(
        _subs({"district": 0}, {"district": 1}), sampling_filters={"district": ["0"]}
    ) == [0]


def test_group_paths_match_and_filters_combine():
    subs = _subs(
        {"g/district": "north", "enum": "e1"},
        {"g/district": "north", "enum": "e2"},
        {"g/district": "south", "enum": "e1"},
    )
    assert _names(
        subs, enumerator_field="enum", enumerators=["e1"], sampling_filters={"district": ["north"]}
    ) == [0]


def test_only_sampling_columns_filter_and_enumerators_need_a_field():
    subs = _subs({"district": "north", "other": "x"})
    assert _names(subs, sampling_filters={"other": ["nope"]}) == [0]
    assert _names(subs, enumerators=["nobody"]) == [0]

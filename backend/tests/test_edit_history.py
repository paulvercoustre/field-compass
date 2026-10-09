"""What an edit made in Kobo changed, answer by answer."""

from etl.data_merger import calculate_json_diff


def test_a_changed_answer_keeps_what_it_was():
    before = {"hh/hh_size": 14, "hh/notes": "two goats", "meta/instanceID": "uuid:1"}
    after = {"hh/hh_size": 4, "meta/instanceID": "uuid:2", "hh/resp_age": 30}

    changes = {change["path"]: change for change in calculate_json_diff(before, after)}

    assert changes["/hh~1hh_size"] == {
        "op": "replace",
        "path": "/hh~1hh_size",
        "value": 4,
        "old": 14,
    }
    assert changes["/hh~1notes"] == {"op": "remove", "path": "/hh~1notes", "old": "two goats"}
    assert changes["/hh~1resp_age"] == {"op": "add", "path": "/hh~1resp_age", "value": 30}

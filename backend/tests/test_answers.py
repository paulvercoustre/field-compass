"""forms.answers: the one rule for reading an answer named in settings."""

import pytest

from forms.answers import answer_value, find_answer


@pytest.mark.parametrize(
    ("data", "name", "expected"),
    [
        ({"age": 30}, "age", (30, "age")),
        ({"household/age": 30}, "age", (30, "household/age")),
        ({"a/b/age": 30}, "age", (30, "a/b/age")),
        # An exact key wins over a path that ends with the name.
        ({"group/age": 1, "age": 2}, "age", (2, "age")),
        # A falsy answer is still an answer.
        ({"group/count": 0}, "count", (0, "group/count")),
        # The suffix must be a whole path segment.
        ({"stage": 5}, "age", (None, None)),
        ({"x": 1}, "age", (None, None)),
        # No name, or no data: nothing, and no accidental match on "/None".
        ({"a/None": "trap"}, None, (None, None)),
        ({"a/": "trap"}, "", (None, None)),
        (None, "age", (None, None)),
        ({}, "age", (None, None)),
    ],
)
def test_find_answer(data, name, expected):
    assert find_answer(data, name) == expected


def test_answer_value_is_the_answer_alone():
    assert answer_value({"g/age": 30}, "age") == 30
    assert answer_value({"g/age": 30}, "name") is None

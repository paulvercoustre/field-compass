"""
Finding an answer in a Kobo submission by question name.

Kobo keys each answer by its full group path (``household/roster/age``), but
survey settings name a question by itself (``age``). Everything that reads an
answer named in settings -- the checks, the filters, the progress counts, the
AI review inputs -- has to make the same choice, so it is made here once:

1. an exact key wins;
2. otherwise the first key that ends in ``/<name>``.

The frontend's ``utils/answers.ts`` mirrors this.
"""

from collections.abc import Mapping
from typing import Any


def find_answer(
    submission_data: Mapping[str, Any] | None, name: str | None
) -> tuple[Any, str | None]:
    """The answer and the key it was found under; ``(None, None)`` when absent.

    A missing name is answered explicitly: otherwise the suffix search would
    look for the literal ``"/None"`` and miss it by accident.
    """
    if not name or not submission_data:
        return None, None
    if name in submission_data:
        return submission_data[name], name
    suffix = f"/{name}"
    for key, value in submission_data.items():
        if key.endswith(suffix):
            return value, key
    return None, None


def answer_value(submission_data: Mapping[str, Any] | None, name: str | None) -> Any:
    """Just the answer, or None."""
    return find_answer(submission_data, name)[0]

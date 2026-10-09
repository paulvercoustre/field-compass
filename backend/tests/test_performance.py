"""Field Team's figures per enumerator."""

from database.models import SubmissionCurrent
from services.progress import compute_performance

CONFIG = {"core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"}}


def _submission(enumerator: str | None) -> SubmissionCurrent:
    data = {} if enumerator is None else {"enumerator_id": enumerator}
    return SubmissionCurrent(submission_data=data, qa_status="FLAGGED", data_quality_issues=[])


def test_submissions_with_no_enumerator_are_counted_apart():
    """Not a phantom "Unknown" enumerator, which would join the team count and the rankings."""
    performance = compute_performance(
        [_submission("enum_01"), _submission("enum_01"), _submission(None), _submission("  ")],
        CONFIG,
    )

    assert [row.id for row in performance.collection] == ["enum_01"]
    assert [row.id for row in performance.quality] == ["enum_01"]
    assert performance.collection[0].total == 2
    assert performance.no_enumerator == 2

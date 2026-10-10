"""Field Team's figures per enumerator."""

from database.models import SubmissionCurrent
from services.progress import compute_performance

CONFIG = {"core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"}}


def _submission(enumerator: str | None) -> SubmissionCurrent:
    data = {} if enumerator is None else {"enumerator_id": enumerator}
    return SubmissionCurrent(submission_data=data, qa_status="FLAGGED", data_quality_issues=[])


def test_submissions_with_no_enumerator_are_counted_apart():
    """
    In the team's figures, so they match Data quality's; never a phantom
    "Unknown" enumerator, which would join the enumerators and the rankings.
    """
    performance = compute_performance(
        [_submission("enum_01"), _submission("enum_01"), _submission(None), _submission("  ")],
        CONFIG,
    )

    assert [row.id for row in performance.enumerators] == ["enum_01"]
    assert performance.enumerators[0].submissions == 2
    assert performance.team is not None and performance.team.submissions == 4
    assert performance.no_enumerator is not None
    assert performance.no_enumerator.submissions == 2


def test_no_summary_when_every_submission_has_an_enumerator():
    performance = compute_performance([_submission("enum_01")], CONFIG)
    assert performance.no_enumerator is None

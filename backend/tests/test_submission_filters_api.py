"""
/api/quality/overview and /api/submissions, through their filters.

Both endpoints narrow a survey's submissions by enumerator and by sampling
variable, and the quality overview then aggregates what is left. These tests
pin that behaviour end to end, so the computation can live outside the
routers without changing what either endpoint answers.
"""

import itertools
from datetime import datetime
from uuid import UUID, uuid4

import pytest

from database.models import SubmissionCurrent
from tests.test_api_endpoints import TestingSessionLocal, client  # noqa: F401 -- fixture

_ids = itertools.count(70000)


@pytest.fixture
def survey(client):  # noqa: F811 -- the fixture above
    response = client.post(
        "/api/surveys",
        json={
            "survey_name": "Filters",
            "kobo_asset_id": "asset_filters",
            "config_data": {
                "core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"},
                "sampling_frame": {"mode": "total", "sampling_cols": ["district"]},
            },
        },
    )
    assert response.status_code == 201
    return response.json()["survey_id"]


def _add(survey_id, data, *, day=1, validation=None, issues=(), qa="PENDING_APPROVAL", dk=None):
    with TestingSessionLocal() as db:
        db.add(
            SubmissionCurrent(
                _id=next(_ids),
                survey_id=UUID(survey_id),
                _uuid=str(uuid4()),
                _submission_time=datetime(2026, 3, day, 10),
                end=datetime(2026, 3, day, 11),
                submission_data=data,
                kobo_validation_status=validation,
                qa_status=qa,
                data_quality_issues=[
                    {"check": check, "field": "f", "value": None, "message": "m"}
                    for check in issues
                ],
                # `dk` don't-know answers out of 100 that allow one.
                dk_count=dk,
                dk_eligible_count=None if dk is None else 100,
                dk_percentage=dk,
            )
        )
        db.commit()


@pytest.fixture
def three(survey):
    """Two enumerators in two districts, on two days."""
    _add(
        survey,
        {"enumerator_id": "e1", "grp/district": "north", "active_interview_time": 20},
        day=1,
        validation="Approved",
        issues=["dk_high"],
        dk=10,
    )
    _add(
        survey,
        {"enumerator_id": "e1", "grp/district": "south", "active_interview_time": 30},
        day=1,
        validation="On Hold",
        issues=["dk_high", "dk_high", "too_fast"],
        dk=30,
    )
    _add(survey, {"enumerator_id": "e2", "grp/district": "north"}, day=2, qa="FLAGGED")
    return survey


class TestQualityOverview:
    def _get(self, client, survey, **params):  # noqa: F811
        response = client.get("/api/quality/overview", params={"survey_id": survey, **params})
        assert response.status_code == 200, response.text
        return response.json()

    def test_aggregates_every_submission(self, client, three):  # noqa: F811
        body = self._get(client, three)

        summary = body["summary"]
        assert summary["submissions"] == 3
        # e2's submission has no issue and no decision: Clean, whatever its qa_status.
        assert (
            summary["needs_review"],
            summary["on_hold"],
            summary["clean"],
            summary["approved"],
            summary["not_approved"],
        ) == (0, 1, 1, 1, 0)
        assert summary["reviewed"] == 1
        assert (summary["flagged"], summary["issues"]) == (2, 4)
        assert summary["issues_per_submission"] == 1.33
        assert summary["dk_rate"] == 20.0
        assert summary["duration_minutes"] == 25.0
        assert (summary["duration_measured"], summary["duration_from_start_end"]) == (2, 0)

        dk_high, too_fast = body["by_check"][:2]
        assert (dk_high["check"], dk_high["flagged"], dk_high["issues"]) == ("dk_high", 2, 3)
        # One Approved, one On hold: neither is waiting.
        assert dk_high["needs_review"] == 0
        assert dk_high["top_enumerator"] == {"id": "e1", "flagged": 2, "submissions": 2}
        assert dk_high["last_14_days"][-2:] == [2, 0]
        assert too_fast["flagged"] == 1
        # A new survey's checks are off, and listed so.
        assert [row["on"] for row in body["by_check"][2:]] == [False] * 10
        assert body["checks_on"] == [] and len(body["checks_off"]) == 10
        assert body["custom_checks"] == 0
        assert body["oldest_needs_review"] is None

        assert [d["date"] for d in body["temporal_data"]] == ["2026-03-01", "2026-03-02"]
        day_one, day_two = body["temporal_data"]
        assert (day_one["submissions"], day_one["issues"], day_one["flagged"]) == (2, 4, 2)
        assert (day_one["approved"], day_one["on_hold"]) == (1, 1)
        assert (day_two["submissions"], day_two["clean"]) == (1, 1)
        assert body["date_range"] == {"start": "2026-03-01", "end": "2026-03-02"}

    def test_filters_by_enumerator(self, client, three):  # noqa: F811
        body = self._get(client, three, enumerator="e2")
        assert body["summary"]["submissions"] == 1

    def test_filters_by_a_sampling_variable_under_its_group_path(self, client, three):  # noqa: F811
        body = self._get(client, three, sampling_filters="district=north")
        assert body["summary"]["submissions"] == 2

    def test_a_variable_that_is_not_a_sampling_column_is_ignored(self, client, three):  # noqa: F811
        body = self._get(client, three, sampling_filters="enumerator_id=nobody")
        assert body["summary"]["submissions"] == 3

    def test_filters_by_date(self, client, three):  # noqa: F811
        assert self._get(client, three, start_date="2026-03-02")["summary"]["submissions"] == 1
        assert self._get(client, three, end_date="2026-03-01")["summary"]["submissions"] == 2

    def test_a_malformed_date_is_a_400(self, client, three):  # noqa: F811
        response = client.get(
            "/api/quality/overview", params={"survey_id": three, "start_date": "03/01/2026"}
        )
        assert response.status_code == 400

    def test_nothing_left_is_all_zeros(self, client, three):  # noqa: F811
        body = self._get(client, three, enumerator="nobody")
        assert body["summary"]["submissions"] == 0
        assert body["summary"]["dk_rate"] is None
        assert body["summary"]["duration_minutes"] is None
        assert body["summary"]["issues_per_submission"] is None
        assert body["temporal_data"] == []
        assert len(body["by_check"]) == 10


class TestSubmissionsList:
    def _ids(self, client, survey, **params):  # noqa: F811
        response = client.get("/api/submissions", params={"survey_id": survey, **params})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == len(body["submissions"])
        return sorted(s["submission_data"]["enumerator_id"] for s in body["submissions"])

    def test_filters_by_enumerator(self, client, three):  # noqa: F811
        assert self._ids(client, three, enumerator="e1") == ["e1", "e1"]

    def test_filters_by_a_sampling_variable_under_its_group_path(self, client, three):  # noqa: F811
        assert self._ids(client, three, sampling_filters="district=south") == ["e1"]

    def test_combines_filters(self, client, three):  # noqa: F811
        assert self._ids(client, three, enumerator="e1,e2", sampling_filters="district=north") == [
            "e1",
            "e2",
        ]

    def test_filters_by_qa_status(self, client, three):  # noqa: F811
        assert self._ids(client, three, qa_status="FLAGGED") == ["e2"]

    def test_not_reviewed_means_no_validation_status(self, client, three):  # noqa: F811
        assert self._ids(client, three, validation_status="Not Reviewed") == ["e2"]
        assert self._ids(client, three, validation_status="Not Reviewed,Approved") == ["e1", "e2"]

    def test_pages(self, client, three):  # noqa: F811
        response = client.get(
            "/api/submissions", params={"survey_id": three, "page": 2, "page_size": 2}
        )
        body = response.json()
        assert (body["total"], len(body["submissions"]), body["page"]) == (3, 1, 2)


class TestNoAnswerUnderAFilter:
    """Both endpoints leave out a submission with no answer to a filtered
    question. The overview used to compare str(None), so filtering on the
    literal "None" matched every unanswered submission."""

    @pytest.fixture
    def unanswered(self, survey):
        _add(survey, {"enumerator_id": "e1", "district": "north"})
        _add(survey, {"enumerator_id": "e2"})
        _add(survey, {"enumerator_id": "e3", "district": ""})
        return survey

    @pytest.mark.parametrize("values", ["north", "north,None", "None"])
    def test_overview(self, client, unanswered, values):  # noqa: F811
        body = client.get(
            "/api/quality/overview",
            params={"survey_id": unanswered, "sampling_filters": f"district={values}"},
        ).json()
        assert body["summary"]["submissions"] == (0 if values == "None" else 1)

    @pytest.mark.parametrize("values", ["north", "north,None", "None"])
    def test_submissions(self, client, unanswered, values):  # noqa: F811
        body = client.get(
            "/api/submissions",
            params={"survey_id": unanswered, "sampling_filters": f"district={values}"},
        ).json()
        assert body["total"] == (0 if values == "None" else 1)

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

        status = body["status_summary"]
        assert status["total_submissions"] == 3
        assert (status["approved_count"], status["on_hold_count"]) == (1, 1)
        assert status["not_reviewed_count"] == 1
        assert status["approved_percentage"] == 33.3

        metrics = body["quality_metrics"]
        assert metrics["total_issues"] == 4
        assert metrics["submissions_with_issues"] == 2
        assert metrics["avg_issues_per_submission"] == 1.33
        assert metrics["avg_dk_percentage"] == 20.0
        assert metrics["avg_active_duration_minutes"] == 25.0

        frequency = {f["check"]: f for f in body["issue_frequency"]}
        assert frequency["dk_high"]["count"] == 3
        assert frequency["dk_high"]["affected_submissions"] == 2
        assert frequency["dk_high"]["percentage"] == 66.7
        assert [f["check"] for f in body["issue_frequency"]] == ["dk_high", "too_fast"]

        assert [d["date"] for d in body["temporal_data"]] == ["2026-03-01", "2026-03-02"]
        assert body["temporal_data"][0]["total_issues"] == 4
        assert body["issue_time_series"][0]["issue_counts"] == {"dk_high": 3, "too_fast": 1}
        assert body["date_range"] == {"start": "2026-03-01", "end": "2026-03-02"}

    def test_filters_by_enumerator(self, client, three):  # noqa: F811
        body = self._get(client, three, enumerator="e2")
        assert body["status_summary"]["total_submissions"] == 1

    def test_filters_by_a_sampling_variable_under_its_group_path(self, client, three):  # noqa: F811
        body = self._get(client, three, sampling_filters="district=north")
        assert body["status_summary"]["total_submissions"] == 2

    def test_a_variable_that_is_not_a_sampling_column_is_ignored(self, client, three):  # noqa: F811
        body = self._get(client, three, sampling_filters="enumerator_id=nobody")
        assert body["status_summary"]["total_submissions"] == 3

    def test_filters_by_date(self, client, three):  # noqa: F811
        assert (
            self._get(client, three, start_date="2026-03-02")["status_summary"]["total_submissions"]
            == 1
        )
        assert (
            self._get(client, three, end_date="2026-03-01")["status_summary"]["total_submissions"]
            == 2
        )

    def test_a_malformed_date_is_a_400(self, client, three):  # noqa: F811
        response = client.get(
            "/api/quality/overview", params={"survey_id": three, "start_date": "03/01/2026"}
        )
        assert response.status_code == 400

    def test_nothing_left_is_all_zeros(self, client, three):  # noqa: F811
        body = self._get(client, three, enumerator="nobody")
        assert body["status_summary"]["total_submissions"] == 0
        assert body["quality_metrics"]["avg_dk_percentage"] is None
        assert body["issue_frequency"] == [] and body["temporal_data"] == []


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

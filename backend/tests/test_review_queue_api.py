"""
The Submissions review queue: tabs, filters, counts and approving clean
submissions together (routers/submissions.py, services/review_queue.py).
"""

import itertools
from datetime import datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import requests

import routers.submissions as submissions_router
from database.models import AudioTranscript, SubmissionCurrent, SurveyAccess, SurveyConfig, User
from etl.kobo_fetcher import KoboFetcher
from tests.test_api_endpoints import (  # noqa: F401 -- fixture
    TEST_USER_ID,
    TestingSessionLocal,
    client,
)

_ids = itertools.count(90000)


@pytest.fixture
def survey(client):  # noqa: F811 -- the fixture above
    response = client.post(
        "/api/surveys",
        json={
            "survey_name": "Queue",
            "kobo_asset_id": "asset_queue",
            "config_data": {
                "core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"},
                "sampling_frame": {"mode": "total", "sampling_cols": ["district"]},
            },
        },
    )
    assert response.status_code == 201
    return response.json()["survey_id"]


def _add(survey_id, data, *, day=1, validation=None, issues=(), llm="skipped", recording=None):
    """A submission; ``recording`` adds an audio transcript in that status."""
    submission_id = next(_ids)
    with TestingSessionLocal() as db:
        db.add(
            SubmissionCurrent(
                _id=submission_id,
                survey_id=UUID(survey_id),
                _uuid=str(uuid4()),
                _submission_time=datetime(2026, 3, day, 10),
                end=datetime(2026, 3, day, 11),
                submission_data=data,
                kobo_validation_status=validation,
                qa_status="FLAGGED" if issues and not validation else "PENDING_APPROVAL",
                data_quality_issues=[
                    {"check": check, "field": "f", "value": None, "message": "m"}
                    for check in issues
                ],
                llm_check_status=llm,
            )
        )
        if recording:
            db.add(
                AudioTranscript(
                    survey_id=UUID(survey_id),
                    submission_id=submission_id,
                    question_path="voice",
                    status=recording,
                )
            )
        db.commit()
    return submission_id


@pytest.fixture
def queue(survey):
    """Two flagged, one on hold, one approved, three clean (one still being checked)."""
    ids = SimpleNamespace(survey=survey)
    ids.short = _add(
        survey,
        {"enumerator_id": "e1", "district": "north", "story": "many problems"},
        day=3,
        issues=["duration_too_short", "outlier_income"],
    )
    ids.dk = _add(
        survey, {"enumerator_id": "e2", "district": "south"}, day=2, issues=["dk_percentage_high"]
    )
    ids.hold = _add(
        survey,
        {"enumerator_id": "e1", "district": "north"},
        day=1,
        validation="On Hold",
        issues=["dk_percentage_high"],
    )
    ids.approved = _add(
        survey, {"enumerator_id": "e2", "district": "north"}, day=1, validation="Approved"
    )
    ids.clean = _add(survey, {"enumerator_id": "e1", "district": "north"}, day=4)
    ids.clean_south = _add(survey, {"enumerator_id": "e2", "district": "south"}, day=5)
    ids.reviewing = _add(survey, {"enumerator_id": "e1", "district": "north"}, day=6, llm="pending")
    return ids


def _list(client, survey, **params):  # noqa: F811
    response = client.get(
        "/api/submissions", params={"survey_id": survey, "page_size": 100, **params}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _facets(client, survey, **params):  # noqa: F811
    response = client.get("/api/submissions/facets", params={"survey_id": survey, **params})
    assert response.status_code == 200, response.text
    return response.json()


def _ids_of(body):
    return [s["_id"] for s in body["submissions"]]


class TestTabs:
    def test_defaults_to_needs_review_most_issues_first(self, client, queue):  # noqa: F811
        body = _list(client, queue.survey)
        assert (body["review"], body["sort"]) == ("needs_review", "issues")
        assert _ids_of(body) == [queue.short, queue.dk]

    def test_defaults_to_all_when_nothing_needs_review(self, client, survey):  # noqa: F811
        clean = _add(survey, {"enumerator_id": "e1"})
        body = _list(client, survey)
        assert (body["review"], body["sort"]) == ("all", "newest")
        assert _ids_of(body) == [clean]

    def test_each_tab(self, client, queue):  # noqa: F811
        assert _ids_of(_list(client, queue.survey, review="on_hold")) == [queue.hold]
        assert _ids_of(_list(client, queue.survey, review="reviewed")) == [queue.approved]
        assert len(_ids_of(_list(client, queue.survey, review="all"))) == 7

    def test_tab_counts_ignore_the_tab(self, client, queue):  # noqa: F811
        facets = _facets(client, queue.survey, review="reviewed")
        assert facets["review"] == "reviewed"
        assert facets["tabs"] == {"needs_review": 2, "on_hold": 1, "reviewed": 1, "all": 7}

    def test_rejects_an_unknown_tab(self, client, queue):  # noqa: F811
        response = client.get("/api/submissions", params={"survey_id": queue.survey, "review": "x"})
        assert response.status_code == 422


class TestFilters:
    def test_issue_filter(self, client, queue):  # noqa: F811
        body = _list(client, queue.survey, review="all", issue="dk_percentage_high")
        assert sorted(_ids_of(body)) == sorted([queue.dk, queue.hold])

    def test_search_finds_ids_and_answers(self, client, queue):  # noqa: F811
        assert _ids_of(_list(client, queue.survey, review="all", q="MANY prob")) == [queue.short]
        assert _ids_of(_list(client, queue.survey, review="all", q=str(queue.dk))) == [queue.dk]

    def test_enumerator_and_district(self, client, queue):  # noqa: F811
        body = _list(
            client, queue.survey, review="all", enumerator="e2", sampling_filters="district=south"
        )
        assert sorted(_ids_of(body)) == sorted([queue.dk, queue.clean_south])

    def test_sorts(self, client, queue):  # noqa: F811
        newest = _ids_of(_list(client, queue.survey, review="all", sort="newest"))
        assert newest[0] == queue.reviewing
        assert _ids_of(_list(client, queue.survey, review="all", sort="oldest")) == newest[::-1]
        by_enumerator = _list(client, queue.survey, review="all", sort="enumerator")["submissions"]
        assert [s["submission_data"]["enumerator_id"] for s in by_enumerator][:4] == ["e1"] * 4


class TestFacets:
    def test_counts_leave_out_their_own_filter(self, client, queue):  # noqa: F811
        facets = _facets(
            client, queue.survey, review="all", issue="dk_percentage_high", enumerator="e1"
        )
        # The issue counts ignore the issue filter but keep the enumerator one.
        assert facets["issues"] == [
            {"value": "dk_percentage_high", "count": 1},
            {"value": "duration_too_short", "count": 1},
            {"value": "outlier_income", "count": 1},
        ]
        # The enumerator counts ignore the enumerator filter but keep the issue one.
        assert facets["enumerators"] == [{"value": "e1", "count": 1}, {"value": "e2", "count": 1}]
        assert facets["tabs"] == {"needs_review": 0, "on_hold": 1, "reviewed": 0, "all": 1}

    def test_sampling_counts(self, client, queue):  # noqa: F811
        facets = _facets(client, queue.survey, review="all")
        assert facets["sampling"] == [
            {
                "variable": "district",
                "values": [{"value": "north", "count": 5}, {"value": "south", "count": 2}],
            }
        ]

    def test_clean_counts_wait_for_unfinished_checks(self, client, queue):  # noqa: F811
        _add(queue.survey, {"enumerator_id": "e1"}, recording="failed")
        _add(queue.survey, {"enumerator_id": "e1"}, recording="success")
        facets = _facets(client, queue.survey)
        # clean, clean_south and the transcribed one; the AI review and the
        # failed transcript are still waiting.
        assert facets["clean"] == {"ready": 3, "waiting": 2}
        assert _facets(client, queue.survey, enumerator="e2")["clean"] == {"ready": 1, "waiting": 0}


class FakeFetcher:
    def __init__(self, refused=()):
        self.calls = []
        self.refused = set(refused)

    def update_validation_statuses(self, asset_uid, submission_ids, status):
        self.calls.append((asset_uid, list(submission_ids), status))
        return [i for i in submission_ids if i not in self.refused]


@pytest.fixture
def fake_kobo(monkeypatch):
    fetcher = FakeFetcher()
    monkeypatch.setattr(submissions_router, "_kobo_fetcher_for", lambda user: fetcher)
    return fetcher


class TestApproveClean:
    def test_approves_only_finished_clean_submissions(self, client, queue, fake_kobo):  # noqa: F811
        response = client.post("/api/submissions/approve-clean", params={"survey_id": queue.survey})
        assert response.status_code == 200, response.text
        assert response.json() == {"approved": 2, "failed": 0}
        [(asset, sent, status)] = fake_kobo.calls
        assert (asset, status) == ("asset_queue", "Approved")
        assert sorted(sent) == sorted([queue.clean, queue.clean_south])

        with TestingSessionLocal() as db:
            rows = {
                s._id: s
                for s in db.query(SubmissionCurrent).filter(
                    SubmissionCurrent._id.in_([queue.clean, queue.reviewing])
                )
            }
        assert (rows[queue.clean].kobo_validation_status, rows[queue.clean].qa_status) == (
            "Approved",
            "APPROVED",
        )
        assert rows[queue.reviewing].kobo_validation_status is None

    def test_follows_the_filters(self, client, queue, fake_kobo):  # noqa: F811
        response = client.post(
            "/api/submissions/approve-clean",
            params={"survey_id": queue.survey, "sampling_filters": "district=south"},
        )
        assert response.json() == {"approved": 1, "failed": 0}
        assert fake_kobo.calls[0][1] == [queue.clean_south]

    def test_reports_what_kobo_refused(self, client, queue, monkeypatch):  # noqa: F811
        fetcher = FakeFetcher(refused={queue.clean})
        monkeypatch.setattr(submissions_router, "_kobo_fetcher_for", lambda user: fetcher)
        response = client.post("/api/submissions/approve-clean", params={"survey_id": queue.survey})
        assert response.json() == {"approved": 1, "failed": 1}
        with TestingSessionLocal() as db:
            assert db.get(SubmissionCurrent, queue.clean).kobo_validation_status is None

    def test_nothing_to_approve(self, client, survey, fake_kobo):  # noqa: F811
        response = client.post("/api/submissions/approve-clean", params={"survey_id": survey})
        assert response.json() == {"approved": 0, "failed": 0}
        assert fake_kobo.calls == []

    def test_viewers_cannot(self, client, fake_kobo):  # noqa: F811
        client.get("/api/surveys")  # creates the test user
        with TestingSessionLocal() as db:
            owner = User(
                user_id=uuid4(),
                email="queue-owner@example.invalid",
                username="queue-owner",
                password_hash="x",
                is_active=True,
                is_admin=False,
            )
            db.add(owner)
            db.commit()

            other = SurveyConfig(
                survey_id=uuid4(),
                survey_name="Someone else's",
                kobo_asset_id="asset_other",
                config_data={},
                user_id=owner.user_id,
            )
            db.add(other)
            db.commit()
            db.add(
                SurveyAccess(
                    survey_id=other.survey_id, user_id=TEST_USER_ID, permission_level="viewer"
                )
            )
            db.commit()
            survey_id = str(other.survey_id)
        _add(survey_id, {})
        assert client.get("/api/submissions", params={"survey_id": survey_id}).status_code == 200
        response = client.post("/api/submissions/approve-clean", params={"survey_id": survey_id})
        assert response.status_code == 403
        assert fake_kobo.calls == []


class FakeSession:
    """Answers PATCH requests from a list of status codes, recording each."""

    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.requests = []

    def patch(self, url, json=None, timeout=None):
        self.requests.append((url, json))
        response = requests.Response()
        response.status_code = self.statuses.pop(0) if self.statuses else 200
        response._content = b"{}"
        return response


class TestKoboBulkValidation:
    def _fetcher(self, statuses):
        fetcher = KoboFetcher(api_token="t", api_url="https://kobo.example/api/v2")
        fetcher.session = FakeSession(statuses)  # type: ignore[assignment]
        return fetcher

    def test_sends_batches(self, monkeypatch):
        monkeypatch.setattr("etl.kobo_fetcher.BULK_VALIDATION_BATCH", 2)
        fetcher = self._fetcher([200, 200])
        assert fetcher.update_validation_statuses("a1", [1, 2, 3], "Approved") == [1, 2, 3]
        url, body = fetcher.session.requests[0]
        assert url == "https://kobo.example/api/v2/assets/a1/data/validation_statuses/"
        assert body == {
            "payload": {
                "submission_ids": [1, 2],
                "validation_status.uid": "validation_status_approved",
            }
        }
        assert fetcher.session.requests[1][1]["payload"]["submission_ids"] == [3]

    def test_falls_back_to_one_at_a_time(self):
        # The bulk endpoint is missing; then one submission is refused.
        fetcher = self._fetcher([404, 200, 400, 200])
        assert fetcher.update_validation_statuses("a1", [1, 2, 3], "Approved") == [1, 3]
        assert [url.rsplit("/data/", 1)[1] for url, _ in fetcher.session.requests[1:]] == [
            "1/validation_status/",
            "2/validation_status/",
            "3/validation_status/",
        ]

    def test_keeps_what_was_done_when_a_later_batch_fails(self, monkeypatch):
        monkeypatch.setattr("etl.kobo_fetcher.BULK_VALIDATION_BATCH", 2)
        fetcher = self._fetcher([200, 500])
        assert fetcher.update_validation_statuses("a1", [1, 2, 3], "Approved") == [1, 2]

    def test_raises_when_nothing_was_done(self):
        fetcher = self._fetcher([500])
        with pytest.raises(requests.HTTPError):
            fetcher.update_validation_statuses("a1", [1], "Approved")


class TestPreferences:
    def test_defaults(self, client):  # noqa: F811
        body = client.get("/api/users/me").json()
        assert body["preferences"] == {"auto_advance": True, "review_shortcuts": True}

    def test_changes_only_what_is_sent(self, client):  # noqa: F811
        response = client.put("/api/users/me", json={"preferences": {"auto_advance": False}})
        assert response.status_code == 200, response.text
        assert response.json()["preferences"] == {"auto_advance": False, "review_shortcuts": True}
        response = client.put("/api/users/me", json={"preferences": {"review_shortcuts": False}})
        assert response.json()["preferences"] == {"auto_advance": False, "review_shortcuts": False}
        assert client.get("/api/users/me").json()["preferences"]["auto_advance"] is False

    def test_ignores_unknown_stored_keys(self, client):  # noqa: F811
        client.get("/api/users/me")
        with TestingSessionLocal() as db:
            db.get(User, TEST_USER_ID).preferences = {"auto_advance": False, "old": 1}
            db.commit()
        assert client.get("/api/users/me").json()["preferences"] == {
            "auto_advance": False,
            "review_shortcuts": True,
        }

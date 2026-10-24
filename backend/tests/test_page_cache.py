"""
The data pages' answers are kept and reused until the survey changes
(services/page_cache.py), read from rows rather than whole submissions
(services/survey_rows.py), with JSON read by orjson (services/database.py).

SQLite has no xmin, so these tests stand in for the fingerprint; on Postgres
it is the count and xmin sum of the survey's submissions and recordings.
"""

import itertools
from datetime import datetime
from uuid import UUID, uuid4

import pytest
import redis

import routers.progress as progress_router
import routers.submissions as submissions_router
from database.models import SubmissionCurrent, SurveyConfig, ValidationRule
from services import page_cache
from services.database import _json_loads
from services.survey_rows import survey_rows, whole
from tests.test_api_endpoints import (  # noqa: F401 -- fixture
    TestingSessionLocal,
    client,
)

_ids = itertools.count(70000)


class _Store:
    def __init__(self):
        self.kept: dict[str, str] = {}

    def get(self, name):
        return self.kept.get(name)

    def set(self, name, value, ex):
        assert ex == page_cache.EXPIRES_SECONDS
        self.kept[name] = value


class _Down:
    def get(self, name):
        raise redis.ConnectionError("down")

    def set(self, name, value, ex):
        raise redis.ConnectionError("down")


@pytest.fixture
def store(monkeypatch):
    """A store in place of Redis, and a fingerprint the test moves on."""
    kept = _Store()
    version = {"now": "1"}
    monkeypatch.setattr(page_cache, "_store", lambda: kept)
    monkeypatch.setattr(page_cache, "fingerprint", lambda db, survey_id: version["now"])
    kept.version = version
    return kept


@pytest.fixture
def survey(client):  # noqa: F811 -- the fixture above
    response = client.post(
        "/api/surveys",
        json={
            "survey_name": "Kept",
            "kobo_asset_id": "asset_kept",
            "config_data": {
                "core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"},
                "sampling_frame": {"mode": "total", "sampling_cols": ["district"]},
            },
        },
    )
    assert response.status_code == 201
    survey_id = response.json()["survey_id"]
    for n, (enumerator, issues) in enumerate([("EN1", ["age"]), ("EN2", []), ("EN1", [])]):
        _add(survey_id, {"enumerator_id": enumerator, "district": "North"}, n + 1, issues)
    return survey_id


def _add(survey_id, data, day, issues):
    with TestingSessionLocal() as db:
        db.add(
            SubmissionCurrent(
                _id=next(_ids),
                survey_id=UUID(survey_id),
                _uuid=str(uuid4()),
                _submission_time=datetime(2026, 3, day, 10),
                end=datetime(2026, 3, day, 11),
                submission_data=data,
                data_quality_issues=[
                    {"check": check, "field": "f", "value": None, "message": "m"}
                    for check in issues
                ],
                llm_check_status="skipped",
            )
        )
        db.commit()


def _counting(monkeypatch, module, name):
    calls = {"n": 0}
    original = getattr(module, name)

    def counted(*args, **kwargs):
        calls["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(module, name, counted)
    return calls


def test_an_answer_is_reused_until_the_survey_changes(client, survey, store, monkeypatch):  # noqa: F811
    work = _counting(monkeypatch, progress_router, "compute_progress")
    first = client.get("/api/progress", params={"survey_id": survey})
    again = client.get("/api/progress", params={"survey_id": survey})
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert work["n"] == 1 and len(store.kept) == 1

    _add(survey, {"enumerator_id": "EN3", "district": "North"}, 9, [])
    store.version["now"] = "2"  # what a new submission does to the fingerprint
    after = client.get("/api/progress", params={"survey_id": survey})
    assert work["n"] == 2
    assert after.json() != first.json()


def test_each_filter_and_page_has_its_own_answer(client, survey, store, monkeypatch):  # noqa: F811
    work = _counting(monkeypatch, submissions_router, "_review_queue")
    pages = [
        {"review": "all"},
        {"review": "all", "enumerator": "EN1"},
        {"review": "all", "page_size": 1, "page": 2},
        {"review": "needs_review"},
    ]
    answers = [
        client.get("/api/submissions", params={"survey_id": survey, **page}).json()
        for page in pages
    ]
    assert [a["total"] for a in answers] == [3, 2, 3, 1]
    assert len(answers[2]["submissions"]) == 1
    assert work["n"] == 4

    for page, answer in zip(pages, answers, strict=True):
        assert client.get("/api/submissions", params={"survey_id": survey, **page}).json() == answer
    facets = client.get("/api/submissions/facets", params={"survey_id": survey}).json()
    assert client.get("/api/submissions/facets", params={"survey_id": survey}).json() == facets
    assert work["n"] == 5  # the four pages again, then the facets once


def test_a_decision_shows_at_once(client, survey, store):  # noqa: F811
    """The fingerprint moves with the row: here by hand, on Postgres by xmin."""
    params = {"survey_id": survey, "review": "needs_review"}
    assert client.get("/api/submissions", params=params).json()["total"] == 1
    with TestingSessionLocal() as db:
        flagged = (
            db.query(SubmissionCurrent).filter(SubmissionCurrent.data_quality_issues != []).one()
        )
        flagged.kobo_validation_status = "On Hold"
        db.commit()
    store.version["now"] = "2"
    assert client.get("/api/submissions", params=params).json()["total"] == 0


def test_new_settings_work_the_answer_out_again(client, survey, store, monkeypatch):  # noqa: F811
    work = _counting(monkeypatch, progress_router, "compute_performance")
    client.get("/api/performance", params={"survey_id": survey})
    with TestingSessionLocal() as db:
        config = db.get(SurveyConfig, UUID(survey))
        config.config_data = {**config.config_data, "global_parameters": {"x": 1}}
        db.commit()
    client.get("/api/performance", params={"survey_id": survey})
    assert work["n"] == 2


def test_the_survey_s_own_rules_count_even_from_a_kept_answer(client, survey, store):  # noqa: F811
    params = {"survey_id": survey}
    assert client.get("/api/quality/overview", params=params).json()["custom_checks"] == 0
    with TestingSessionLocal() as db:
        db.add(
            ValidationRule(
                survey_id=UUID(survey),
                rule_name="Too old",
                rule_data={"check_id": "too_old", "check_expression": "age > 90"},
            )
        )
        db.commit()
    assert client.get("/api/quality/overview", params=params).json()["custom_checks"] == 1
    assert len(store.kept) == 1  # the rest of the answer came from the store


def test_without_redis_every_request_works_it_out(client, survey, monkeypatch):  # noqa: F811
    monkeypatch.setattr(page_cache, "_store", _Down)
    monkeypatch.setattr(page_cache, "fingerprint", lambda db, survey_id: "1")
    work = _counting(monkeypatch, progress_router, "compute_progress")
    for _ in range(2):
        assert client.get("/api/progress", params={"survey_id": survey}).status_code == 200
    assert work["n"] == 2


def test_an_answer_kept_in_another_shape_is_worked_out_again(client, survey, store):  # noqa: F811
    first = client.get("/api/progress", params={"survey_id": survey}).json()
    (name,) = store.kept
    store.kept[name] = '{"not": "progress"}'
    assert client.get("/api/progress", params={"survey_id": survey}).json() == first


def test_sqlite_keeps_nothing(client, survey, monkeypatch):  # noqa: F811
    kept = _Store()
    monkeypatch.setattr(page_cache, "_store", lambda: kept)
    with TestingSessionLocal() as db:
        assert page_cache.fingerprint(db, UUID(survey)) is None
    assert client.get("/api/progress", params={"survey_id": survey}).status_code == 200
    assert kept.kept == {}


def test_rows_read_like_submissions_and_load_whole_in_order(survey):
    with TestingSessionLocal() as db:
        rows = survey_rows(db, UUID(survey)).order_by(SubmissionCurrent._id.desc()).all()
        assert [row.submission_data["enumerator_id"] for row in rows] == ["EN1", "EN2", "EN1"]
        with pytest.raises(AttributeError):
            rows[0].reviewer_notes = "rows are read-only"  # type: ignore[misc]
        subs = whole(db, rows)
        assert [sub._id for sub in subs] == [row._id for row in rows]
        assert all(isinstance(sub, SubmissionCurrent) for sub in subs)
        assert whole(db, []) == []


def test_json_reads_the_same_as_the_standard_library():
    assert _json_loads('{"a": [1, 2.5, "x", null, true]}') == {"a": [1, 2.5, "x", None, True]}
    # Past 64 bits orjson would give a float: these stay exact.
    assert _json_loads('{"n": 123456789012345678901234567890}') == {
        "n": 123456789012345678901234567890
    }
    # A lone surrogate, which orjson refuses.
    assert _json_loads('{"s": "\\ud800"}') == {"s": "\ud800"}

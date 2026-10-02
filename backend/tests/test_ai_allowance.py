"""
Phase 3: the free AI allowance on the operator's key.

200 checked submissions per survey per month and 30 rule requests per user
per day by default, counted from ai_usage. Surveys with their own provider
have no Field Compass limit.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from database.models import AIConnection, AIUsage, SubmissionCurrent, SurveyConfig, User
from etl import pipeline as pipeline_module
from etl.pipeline import ETLPipeline
from services import ai_allowance
from services.ai_allowance import (
    NOT_RUN_ALLOWANCE,
    checks_remaining,
    checks_used,
    month_start,
    next_month_start,
    rule_requests_remaining,
)
from services.ai_usage import QUALITATIVE_CHECK, RULE_GENERATION, RULE_SUGGESTION
from utils.rule_versioning import should_enqueue_llm_check

NOW = datetime(2026, 10, 15, 12, 0)


@pytest.fixture(autouse=True)
def _operator_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")
    for name in (
        "AI_ALLOWANCE_ENABLED",
        "AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH",
        "AI_ALLOWANCE_RULE_REQUESTS_PER_USER_DAY",
    ):
        monkeypatch.delenv(name, raising=False)


def _usage(db, survey_id, *, when=NOW, feature=QUALITATIVE_CHECK, outcome="ok", **fields):
    db.add(
        AIUsage(
            survey_id=survey_id,
            feature=feature,
            model="gpt-5-mini",
            outcome=outcome,
            created_at=when,
            **fields,
        )
    )
    db.commit()


class TestMonths:
    def test_boundaries(self):
        assert month_start(NOW) == datetime(2026, 10, 1)
        assert next_month_start(NOW) == datetime(2026, 11, 1)
        assert next_month_start(datetime(2026, 12, 31, 23)) == datetime(2027, 1, 1)


class TestChecksUsed:
    def test_counts_only_what_this_month_spent_on_the_operator_key(
        self, test_db, test_survey_config
    ):
        sid = test_survey_config.survey_id
        owner = User(user_id=uuid4(), email="o@example.invalid", username="o", password_hash="x")
        test_db.add(owner)
        test_db.commit()
        connection = AIConnection(
            owner_user_id=owner.user_id,
            label="Own",
            base_url="https://own.example/v1",
            check_model="m",
            status="ok",
            consecutive_failures=0,
        )
        test_db.add(connection)
        test_db.commit()

        _usage(test_db, sid)  # counted
        _usage(test_db, sid, outcome="bad_response")  # billed, counted
        _usage(test_db, sid, outcome="unavailable")  # never reached the provider
        _usage(test_db, sid, outcome="auth")  # rejected, nothing spent
        _usage(test_db, sid, when=datetime(2026, 9, 30, 23, 59))  # last month
        _usage(test_db, sid, feature=RULE_GENERATION)  # not a check
        _usage(test_db, sid, connection_id=connection.connection_id)  # their own key

        assert checks_used(test_db, sid, NOW) == 2

    def test_queued_checks_are_reserved(self, test_db, test_survey_config, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "5")
        sid = test_survey_config.survey_id
        _usage(test_db, sid)
        for n, status in enumerate(("pending", "running", "success")):
            test_db.add(
                SubmissionCurrent(
                    _id=n + 1,
                    survey_id=sid,
                    _uuid=f"u{n}",
                    _submission_time=NOW,
                    end=NOW,
                    submission_data={},
                    llm_check_status=status,
                )
            )
        test_db.commit()

        # 5 - 1 spent - 2 queued or running
        assert checks_remaining(test_db, sid, NOW) == 2

    def test_allowance_off_or_no_operator_key(self, test_db, test_survey_config, monkeypatch):
        sid = test_survey_config.survey_id
        monkeypatch.setenv("AI_ALLOWANCE_ENABLED", "false")
        assert checks_remaining(test_db, sid, NOW) == 0
        monkeypatch.delenv("AI_ALLOWANCE_ENABLED")
        monkeypatch.delenv("OPENAI_API_KEY")
        assert checks_remaining(test_db, sid, NOW) == 0


class TestRuleRequests:
    def test_per_user_per_day(self, test_db, test_survey_config, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_RULE_REQUESTS_PER_USER_DAY", "3")
        sid = test_survey_config.survey_id
        me = User(user_id=uuid4(), email="me@example.invalid", username="me", password_hash="x")
        test_db.add(me)
        test_db.commit()

        _usage(test_db, sid, feature=RULE_GENERATION, user_id=me.user_id)
        _usage(test_db, sid, feature=RULE_SUGGESTION, user_id=me.user_id)
        _usage(test_db, sid, feature=RULE_GENERATION, user_id=me.user_id, outcome="timeout")
        _usage(
            test_db,
            sid,
            feature=RULE_GENERATION,
            user_id=me.user_id,
            when=NOW - timedelta(days=1),
        )

        assert rule_requests_remaining(test_db, me.user_id, NOW) == 1


def test_a_check_not_run_for_allowance_is_tried_again():
    assert should_enqueue_llm_check("not_run_allowance", "r", "i", "r", "i") == (
        True,
        "allowance_retry",
    )


# --- a pull on the operator's key -------------------------------------------------


class _FakeFetcher:
    def __init__(self, submissions):
        self.submissions = submissions

    def get_asset_submissions(self, **_):
        return self.submissions

    def get_asset_info(self, asset_uid):
        return {}


class _FakeTask:
    queued: list = []

    @classmethod
    def apply_async(cls, kwargs, task_id):
        cls.queued.append(kwargs["payload"]["submission_id"])
        return SimpleNamespace(id=task_id)


def _kobo_submission(n):
    return {
        "_id": 5000 + n,
        "_uuid": f"allowance-{n}",
        "_submission_time": "2026-10-10T10:00:00Z",
        "start": "2026-10-10T09:30:00Z",
        "end": "2026-10-10T10:00:00Z",
        "enumerator_id": "E1",
        "comments": f"Answer number {n}",
    }


@pytest.fixture
def ai_survey(test_db, test_survey_config, monkeypatch):
    config = dict(test_survey_config.config_data)
    config["quality_checks"] = {
        "flag_llm_qualitative": True,
        "llm_qualitative_fields": ["comments"],
        "llm_check_types": ["relevance"],
    }
    test_survey_config.config_data = config
    test_survey_config.kobo_asset_id = "aAllowance"
    test_db.commit()

    _FakeTask.queued = []
    monkeypatch.setattr(pipeline_module, "run_qualitative_check_task", _FakeTask)
    return test_survey_config


def _pull(db, survey, count):
    fetcher = _FakeFetcher([_kobo_submission(n) for n in range(count)])
    return ETLPipeline(db, kobo_fetcher=fetcher).run_pipeline(str(survey.survey_id))


class TestPull:
    def test_queues_up_to_the_allowance_and_holds_the_rest(self, test_db, ai_survey, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "3")
        stats = _pull(test_db, ai_survey, 5)

        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (3, 2)
        held = (
            test_db.query(SubmissionCurrent)
            .filter(SubmissionCurrent.llm_check_status == NOT_RUN_ALLOWANCE)
            .all()
        )
        assert len(held) == 2
        assert all(s.llm_last_error.startswith("allowance: ") for s in held)

    def test_held_checks_run_once_there_is_allowance(self, test_db, ai_survey, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "3")
        _pull(test_db, ai_survey, 5)

        # The queued three finish (spending three), and the limit is raised.
        test_db.query(SubmissionCurrent).filter(
            SubmissionCurrent.llm_check_status == "pending"
        ).update({SubmissionCurrent.llm_check_status: "success"})
        for _ in range(3):
            _usage(test_db, ai_survey.survey_id, when=datetime.utcnow())
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "10")

        stats = _pull(test_db, ai_survey, 5)
        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (2, 0)

    def test_own_provider_has_no_field_compass_limit(self, test_db, ai_survey, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "0")
        owner = User(
            user_id=uuid4(), email="own@example.invalid", username="own", password_hash="x"
        )
        test_db.add(owner)
        test_db.commit()
        connection = AIConnection(
            owner_user_id=owner.user_id,
            label="Own",
            base_url="https://own.example/v1",
            check_model="m",
            status="ok",
            consecutive_failures=0,
        )
        test_db.add(connection)
        test_db.commit()
        survey = test_db.get(SurveyConfig, ai_survey.survey_id)
        survey.user_id = owner.user_id
        survey.ai_connection_id = connection.connection_id
        test_db.commit()

        stats = _pull(test_db, ai_survey, 4)
        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (4, 0)


# --- HTTP ---------------------------------------------------------------------


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from database.models import Base
    from main import app
    from services.auth import get_current_active_user
    from services.database import get_db
    from tests.test_api_endpoints import engine, override_current_user, override_get_db

    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_current_user
    with TestClient(app) as test_client:
        test_client.get("/api/surveys")  # creates the test user
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _api_survey(client):
    response = client.post(
        "/api/surveys", json={"survey_name": f"Allowance {uuid4()}", "config_data": {}}
    )
    return response.json()["survey_id"]


class TestHttp:
    def test_rule_requests_stop_at_the_daily_limit(self, client, monkeypatch):
        from uuid import UUID

        from tests.test_api_endpoints import TEST_USER_ID, TestingSessionLocal

        monkeypatch.setenv("AI_ALLOWANCE_RULE_REQUESTS_PER_USER_DAY", "1")
        survey_id = _api_survey(client)
        db = TestingSessionLocal()
        _usage(
            db,
            UUID(survey_id),
            feature=RULE_GENERATION,
            user_id=TEST_USER_ID,
            when=datetime.utcnow(),
        )
        db.close()

        response = client.post(
            "/api/ai/generate-rule", json={"survey_id": survey_id, "prompt": "age over 100"}
        )
        assert response.status_code == 429
        assert "free AI rule requests" in response.json()["detail"]

    def test_usage_this_month(self, client, monkeypatch):
        from uuid import UUID

        from tests.test_api_endpoints import TestingSessionLocal

        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "200")
        survey_id = _api_survey(client)
        db = TestingSessionLocal()
        now = datetime.utcnow()
        _usage(db, UUID(survey_id), when=now, input_tokens=500, output_tokens=300)
        _usage(db, UUID(survey_id), when=now, outcome="timeout")
        _usage(db, UUID(survey_id), when=now, feature=RULE_SUGGESTION, input_tokens=4000)
        db.close()

        body = client.get(f"/api/surveys/{survey_id}/ai-usage").json()
        assert body["month"] == now.strftime("%Y-%m")
        assert body["provider"] is None
        assert body["allowance"] == {"limit": 200, "used": 1, "in_flight": 0, "remaining": 199}
        checks = next(f for f in body["by_feature"] if f["feature"] == QUALITATIVE_CHECK)
        assert (checks["calls"], checks["failed"], checks["input_tokens"]) == (2, 1, 500)


def test_not_run_message_names_the_month():
    message = ai_allowance.not_run_message(NOW)
    assert message.startswith("allowance: ") and "October" in message

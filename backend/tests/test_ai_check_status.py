"""
AI check outcomes are reported honestly.

A failed call used to come back as an empty result, which the worker stored
as "success": with a rejected key, every submission read "No qualitative
issues detected" and none was ever retried. These tests pin the rule that a
failure is stored as a failure, with a category the UI can explain.
"""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import openai
import pytest
from sqlalchemy.orm import sessionmaker

from database.models import SubmissionCurrent
from services import ai_client, qualitative_worker, qualitative_worker_runtime
from services.ai_client import AIClient
from services.ai_errors import (
    AUTH,
    BAD_REQUEST,
    BAD_RESPONSE,
    NOT_CONFIGURED,
    PROVIDER_QUOTA,
    RATE_LIMITED,
    TIMEOUT,
    UNAVAILABLE,
    AIError,
    classify,
)
from services.ai_service import AIService

_REQUEST = httpx.Request("POST", "https://api.example.com/v1/chat/completions")


def _status_error(cls, status, message, code=None, headers=None):
    response = httpx.Response(status, request=_REQUEST, headers=headers or {})
    return cls(message, response=response, body={"message": message, "code": code})


class TestClassify:
    def test_rejected_key(self):
        error = classify(_status_error(openai.AuthenticationError, 401, "Incorrect API key"))
        assert (error.category, error.message, error.retryable) == (
            AUTH,
            "Incorrect API key",
            False,
        )

    def test_out_of_credit_is_not_a_rate_limit(self):
        error = classify(
            _status_error(openai.RateLimitError, 429, "No quota", code="insufficient_quota")
        )
        assert (error.category, error.retryable) == (PROVIDER_QUOTA, False)

    def test_rate_limit_honours_retry_after(self):
        error = classify(
            _status_error(openai.RateLimitError, 429, "Slow down", headers={"retry-after": "12"})
        )
        assert (error.category, error.retry_after, error.retryable) == (RATE_LIMITED, 12.0, True)

    def test_retry_after_is_capped(self):
        error = classify(
            _status_error(openai.RateLimitError, 429, "Slow down", headers={"retry-after": "9999"})
        )
        assert error.retry_after == 300

    def test_server_error_and_network(self):
        assert classify(_status_error(openai.InternalServerError, 503, "down")).category == (
            UNAVAILABLE
        )
        assert classify(openai.APIConnectionError(request=_REQUEST)).category == UNAVAILABLE
        assert classify(openai.APITimeoutError(request=_REQUEST)).category == TIMEOUT

    def test_wrong_model_is_not_retried(self):
        error = classify(_status_error(openai.NotFoundError, 404, "model does not exist"))
        assert (error.category, error.retryable) == (BAD_REQUEST, False)

    def test_anything_else_is_a_bad_response(self):
        assert classify(ValueError("nope")).category == BAD_RESPONSE

    def test_echoed_key_is_hidden(self):
        message = "Incorrect API key provided: sk-inval**************ting. You can find it at …"
        error = classify(_status_error(openai.AuthenticationError, 401, message))
        assert "sk-" not in error.message
        assert error.message.startswith("Incorrect API key provided: [key hidden].")

    def test_stored_form(self):
        assert str(AIError(AUTH, "Incorrect API key")) == "auth: Incorrect API key"


def _service_replying(content=None, raises=None, finish_reason="stop"):
    service = AIService.__new__(AIService)
    service.api_key = "sk-test"
    service.qual_check_model = "gpt-4o-mini"
    service.qual_check_max_completion_tokens = 500
    service.temperature = 0.2
    service.timeout = 5

    def create(**_):
        if raises:
            raise raises
        message = SimpleNamespace(content=content)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason=finish_reason)]
        )

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    service.ai = AIClient(client_factory=lambda **_: fake)
    return service


@pytest.fixture(autouse=True)
def _operator_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    ai_client._OPERATOR_CAPABILITIES.clear()


def _check(service):
    return service.check_qualitative_responses(
        field_values={"comments": "fine"},
        question_contexts={"comments": "Comments"},
        dk_codes=[-99],
        dk_string="dk",
        check_types=["relevance"],
    )


class TestCheckQualitativeResponses:
    def test_an_empty_list_means_checked_and_clean(self):
        assert _check(_service_replying('{"issues": []}')) == []

    def test_findings_are_filtered_to_enabled_check_types(self):
        relevance, completeness = (
            {
                "field": "comments",
                "value": "x",
                "check_type": kind,
                "message": "m",
                "reasoning": "r",
            }
            for kind in ("relevance", "completeness")
        )
        reply = json.dumps({"issues": [relevance, completeness]})
        assert _check(_service_replying(reply)) == [relevance]

    def test_provider_error_is_raised_not_swallowed(self):
        service = _service_replying(
            raises=_status_error(openai.AuthenticationError, 401, "Incorrect API key")
        )
        with pytest.raises(AIError) as raised:
            _check(service)
        assert raised.value.category == AUTH

    def test_invalid_json_is_a_bad_response(self):
        with pytest.raises(AIError) as raised:
            _check(_service_replying("not json"))
        assert raised.value.category == BAD_RESPONSE

    def test_wrong_shape_is_a_bad_response(self):
        with pytest.raises(AIError) as raised:
            _check(_service_replying('{"findings": []}'))
        assert raised.value.category == BAD_RESPONSE

    def test_truncated_reply_says_so(self):
        with pytest.raises(AIError) as raised:
            _check(_service_replying(None, finish_reason="length"))
        assert "ran out of output tokens" in raised.value.message

    def test_no_key_is_not_configured(self):
        service = _service_replying("{}")
        service.api_key = None
        with pytest.raises(AIError) as raised:
            _check(service)
        assert raised.value.category == NOT_CONFIGURED


# --- the worker ---------------------------------------------------------------

EARLIER_FINDING = {
    "check": "qual_relevance",
    "field": "comments",
    "value": "old",
    "message": "Off topic",
    "metadata": {"source": "llm_qualitative_v1"},
}


@pytest.fixture
def ai_survey(test_db, test_survey_config):
    config = dict(test_survey_config.config_data)
    config["quality_checks"] = {
        "flag_llm_qualitative": True,
        "llm_qualitative_fields": ["comments"],
        "llm_check_types": ["relevance"],
    }
    test_survey_config.config_data = config
    test_db.commit()
    return test_survey_config


def _add_submission(db, survey, **fields):
    submission = SubmissionCurrent(
        _id=fields.pop("_id", 1),
        survey_id=survey.survey_id,
        _uuid=fields.pop("_uuid", "uuid-ai-1"),
        _submission_time=datetime(2023, 6, 1),
        end=datetime(2023, 6, 1, 1),
        submission_data={"comments": "The market was closed", "enumerator_id": "e1"},
        data_quality_issues=fields.pop("data_quality_issues", []),
        qa_status=fields.pop("qa_status", "PENDING_APPROVAL"),
        llm_check_status=fields.pop("llm_check_status", "pending"),
        llm_rules_hash="rules",
        llm_input_hash="input",
        **fields,
    )
    db.add(submission)
    db.commit()
    return submission


class _FakeAIService:
    """Stands in for AIService in the worker: replies, or raises."""

    outcome: object = []

    def __init__(self):
        self.qual_check_model = "fake-model"

    def is_available(self):
        return True

    def check_qualitative_responses(self, **_):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture
def run_job(test_db, monkeypatch):
    sessions = sessionmaker(bind=test_db.get_bind())
    monkeypatch.setattr(qualitative_worker_runtime, "SessionLocal", sessions)
    monkeypatch.setattr(qualitative_worker_runtime, "AIService", _FakeAIService)

    def run(survey, outcome, final_attempt=True):
        _FakeAIService.outcome = outcome
        payload = {
            "survey_id": str(survey.survey_id),
            "submission_id": 1,
            "llm_rules_hash": "rules",
            "llm_input_hash": "input",
        }
        try:
            return qualitative_worker_runtime.run_qualitative_check_job(
                payload, job_id="job-1", final_attempt=final_attempt
            )
        finally:
            test_db.expire_all()

    return run


def _stored(db):
    return db.query(SubmissionCurrent).filter(SubmissionCurrent._id == 1).one()


class TestWorker:
    def test_rejected_key_is_stored_as_failed(self, test_db, ai_survey, run_job):
        _add_submission(test_db, ai_survey)
        result = run_job(ai_survey, AIError(AUTH, "Incorrect API key"))

        stored = _stored(test_db)
        assert result["status"] == "failed"
        assert stored.llm_check_status == "failed"
        assert stored.llm_last_error == "auth: Incorrect API key"
        assert stored.llm_checked_at is not None

    def test_failure_keeps_the_last_real_findings(self, test_db, ai_survey, run_job):
        _add_submission(test_db, ai_survey, data_quality_issues=[EARLIER_FINDING])
        run_job(ai_survey, AIError(AUTH, "Incorrect API key"))

        assert _stored(test_db).data_quality_issues == [EARLIER_FINDING]

    def test_temporary_failure_with_attempts_left_is_retried(self, test_db, ai_survey, run_job):
        _add_submission(test_db, ai_survey)
        with pytest.raises(AIError):
            run_job(ai_survey, AIError(RATE_LIMITED, "Slow down"), final_attempt=False)

        stored = _stored(test_db)
        assert stored.llm_check_status == "pending"
        assert stored.llm_last_error == "rate_limited: Slow down (retrying)"

    def test_temporary_failure_on_the_last_attempt_fails(self, test_db, ai_survey, run_job):
        _add_submission(test_db, ai_survey)
        run_job(ai_survey, AIError(RATE_LIMITED, "Slow down"), final_attempt=True)

        stored = _stored(test_db)
        assert (stored.llm_check_status, stored.llm_last_error) == (
            "failed",
            "rate_limited: Slow down",
        )

    def test_findings_flag_the_submission(self, test_db, ai_survey, run_job):
        """F-10: an AI-only problem must count as needing review."""
        _add_submission(test_db, ai_survey)
        finding = {
            "field": "comments",
            "value": "x",
            "check_type": "relevance",
            "message": "Off topic",
        }
        run_job(ai_survey, [finding])

        stored = _stored(test_db)
        assert stored.llm_check_status == "success"
        assert stored.qa_status == "FLAGGED"

    def test_kobo_approval_still_wins(self, test_db, ai_survey, run_job):
        _add_submission(test_db, ai_survey, kobo_validation_status="Approved")
        finding = {"field": "comments", "check_type": "relevance", "message": "Off topic"}
        run_job(ai_survey, [finding])

        assert _stored(test_db).qa_status == "APPROVED"

    def test_clean_check_clears_an_ai_only_flag(self, test_db, ai_survey, run_job):
        _add_submission(
            test_db, ai_survey, data_quality_issues=[EARLIER_FINDING], qa_status="FLAGGED"
        )
        run_job(ai_survey, [])

        stored = _stored(test_db)
        assert (stored.llm_check_status, stored.qa_status) == ("success", "PENDING_APPROVAL")


class TestBackoff:
    def test_waits_grow(self, monkeypatch):
        monkeypatch.setattr(qualitative_worker.random, "uniform", lambda a, b: 0)
        waits = [qualitative_worker._backoff_seconds(n) for n in range(3)]
        assert waits == [30, 60, 120]

    def test_retry_after_is_honoured_up_to_the_cap(self, monkeypatch):
        monkeypatch.setattr(qualitative_worker.random, "uniform", lambda a, b: 0)
        assert qualitative_worker._backoff_seconds(0, retry_after=90) == 90
        assert qualitative_worker._backoff_seconds(5) == 300


class TestStalledSweep:
    """F-17: no check shows "in progress" forever."""

    def test_sweeps_only_checks_that_will_never_finish(self, test_db, ai_survey, monkeypatch):
        monkeypatch.setattr(
            qualitative_worker, "SessionLocal", sessionmaker(bind=test_db.get_bind())
        )
        now = datetime.utcnow()
        cases = {
            1: ("running", {"llm_started_at": now - timedelta(minutes=20)}, "failed"),
            2: ("running", {"llm_started_at": now - timedelta(minutes=5)}, "running"),
            3: ("pending", {"llm_queued_at": now - timedelta(hours=7)}, "failed"),
            4: ("pending", {"llm_queued_at": now - timedelta(hours=1)}, "pending"),
            5: ("success", {"llm_started_at": now - timedelta(days=3)}, "success"),
        }
        for _id, (status, times, _) in cases.items():
            _add_submission(
                test_db, ai_survey, _id=_id, _uuid=f"uuid-{_id}", llm_check_status=status, **times
            )

        assert qualitative_worker.sweep_stalled_qualitative_checks() == 2

        test_db.expire_all()
        for _id, (_, _, expected) in cases.items():
            stored = test_db.query(SubmissionCurrent).filter(SubmissionCurrent._id == _id).one()
            assert stored.llm_check_status == expected, _id
            if expected == "failed":
                assert stored.llm_last_error.startswith("timeout: ")


# --- re-running a survey's AI checks -------------------------------------------


class TestRerunEndpoint:
    @pytest.fixture
    def client(self):
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
            yield test_client
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)

    def _survey_with_checked_submissions(self, owner_id):
        from uuid import uuid4

        from database.models import SurveyConfig
        from tests.test_api_endpoints import TestingSessionLocal

        db = TestingSessionLocal()
        survey = SurveyConfig(
            survey_id=uuid4(), survey_name=f"AI {uuid4()}", config_data={}, user_id=owner_id
        )
        db.add(survey)
        db.commit()
        for n in (1, 2):
            _add_submission(db, survey, _id=n, _uuid=f"rerun-{n}", llm_check_status="success")
        survey_id = survey.survey_id
        db.close()
        return survey_id

    def test_owner_resets_every_submission(self, client):
        from tests.test_api_endpoints import TestingSessionLocal

        client.get("/api/surveys")  # creates the test user
        from tests.test_api_endpoints import TEST_USER_ID

        survey_id = self._survey_with_checked_submissions(TEST_USER_ID)

        response = client.post(f"/api/surveys/{survey_id}/ai-checks/rerun")
        assert response.status_code == 200, response.text
        assert response.json() == {"submissions": 2}

        db = TestingSessionLocal()
        hashes = {s.llm_rules_hash for s in db.query(SubmissionCurrent).all()}
        db.close()
        assert hashes == {None}

    def test_an_editor_cannot(self, client):
        from uuid import uuid4

        from database.models import SurveyAccess, User
        from tests.test_api_endpoints import TEST_USER_ID, TestingSessionLocal

        client.get("/api/surveys")  # creates the test user
        db = TestingSessionLocal()
        owner = User(
            user_id=uuid4(),
            email="owner@example.invalid",
            username="owner",
            password_hash="x",
            is_active=True,
            is_admin=False,
        )
        db.add(owner)
        db.commit()
        owner_id = owner.user_id
        db.close()

        survey_id = self._survey_with_checked_submissions(owner_id)
        db = TestingSessionLocal()
        db.add(SurveyAccess(survey_id=survey_id, user_id=TEST_USER_ID, permission_level="editor"))
        db.commit()
        db.close()

        response = client.post(f"/api/surveys/{survey_id}/ai-checks/rerun")
        assert response.status_code == 403


def test_prompt_names_dk_strings_not_a_python_list():
    """The prompt read `Remember: "['dk']"` with a list-shaped dk_string_value."""
    sent = []

    def create(**request):
        sent.append(request)
        message = SimpleNamespace(content='{"issues": []}', refusal=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")])

    service = _service_replying()
    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    service.ai = AIClient(client_factory=lambda **_: fake)
    service.check_qualitative_responses(
        field_values={"comments": "fine"},
        question_contexts={"comments": "Comments"},
        dk_codes=[-99],
        dk_string=["dk", "dont_know"],
        check_types=["relevance"],
    )

    prompt = " ".join(message["content"] for message in sent[0]["messages"])
    assert "['" not in prompt
    assert '"dk" or "dont_know"' in prompt

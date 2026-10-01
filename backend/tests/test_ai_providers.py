"""
Phase 2: a survey can use its owner's own OpenAI-compatible provider.

Covers which addresses may be called, how a survey's provider is chosen,
how each call updates the provider's health, and the HTTP API -- in
particular that a stored key never comes back out.
"""

import socket
from datetime import datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from database.models import AIConnection, AIUsage, Base, SubmissionCurrent, SurveyConfig, User
from services import ai_endpoints, ai_providers, qualitative_worker_runtime
from services.ai_client import Capabilities, ResolvedProvider
from services.ai_endpoints import EndpointRejected, validate_base_url
from services.ai_errors import AUTH, BAD_REQUEST, AIError
from services.ai_providers import (
    CHECKS,
    FAILING,
    RULES,
    note_outcome,
    paused_error,
    resolve_provider,
)
from services.ai_usage import QUALITATIVE_CHECK, usage_recorder
from services.auth import encrypt_api_key

PUBLIC_IP = "104.18.6.192"
SECRET_KEY = "sk-proj-THIS-IS-THE-SECRET-1234"


def _resolver(*addresses):
    def resolve(host, port, **_):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in addresses]

    return resolve


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch):
    """Every host resolves to a public address unless a test says otherwise."""
    monkeypatch.setattr(ai_endpoints.socket, "getaddrinfo", _resolver(PUBLIC_IP))
    monkeypatch.delenv("AI_ALLOW_PRIVATE_ENDPOINTS", raising=False)


# --- addresses ----------------------------------------------------------------


class TestValidateBaseUrl:
    def test_public_https(self):
        assert validate_base_url(" https://api.openai.com/v1/ ") == "https://api.openai.com/v1"

    @pytest.mark.parametrize(
        "address",
        ["127.0.0.1", "10.0.0.5", "172.17.0.2", "192.168.1.10", "169.254.169.254", "::1"],
    )
    def test_private_and_local_addresses_are_refused(self, address):
        with pytest.raises(EndpointRejected, match="private or local"):
            validate_base_url("https://llm.example", resolve=_resolver(address))

    def test_a_public_name_pointing_inside_is_refused(self):
        with pytest.raises(EndpointRejected):
            validate_base_url("https://looks-public.example", resolve=_resolver("10.1.2.3"))

    def test_any_private_address_among_several_is_refused(self):
        with pytest.raises(EndpointRejected):
            validate_base_url("https://x.example", resolve=_resolver(PUBLIC_IP, "127.0.0.1"))

    def test_ipv4_mapped_ipv6_is_unwrapped(self):
        with pytest.raises(EndpointRejected):
            validate_base_url("https://x.example", resolve=_resolver("::ffff:169.254.169.254"))

    def test_http_needs_the_operator_flag(self):
        with pytest.raises(EndpointRejected, match="https"):
            validate_base_url("http://api.example/v1")

    def test_operator_flag_allows_self_hosted(self, monkeypatch):
        monkeypatch.setenv("AI_ALLOW_PRIVATE_ENDPOINTS", "true")
        url = validate_base_url("http://ollama:11434/v1", resolve=_resolver("172.18.0.4"))
        assert url == "http://ollama:11434/v1"

    def test_credentials_in_the_address(self):
        with pytest.raises(EndpointRejected, match="API key field"):
            validate_base_url("https://user:sk-123@api.example/v1")

    def test_unresolvable_host(self):
        def fail(*_, **__):
            raise socket.gaierror("nope")

        with pytest.raises(EndpointRejected, match="Could not find"):
            validate_base_url("https://no-such-host.example", resolve=fail)

    @pytest.mark.parametrize("url", ["", "api.openai.com/v1", "ftp://api.example"])
    def test_not_a_web_address(self, url):
        with pytest.raises(EndpointRejected):
            validate_base_url(url)


# --- choosing a survey's provider ----------------------------------------------


def _user(db, email="owner@example.invalid"):
    user = User(
        user_id=uuid4(),
        email=email,
        username=email.split("@")[0],
        password_hash="x",
        is_active=True,
        is_admin=False,
    )
    db.add(user)
    db.commit()
    return user


def _connection(db, owner, **fields):
    connection = AIConnection(
        owner_user_id=owner.user_id,
        label=fields.pop("label", "WFP Azure"),
        preset=fields.pop("preset", "azure"),
        base_url=fields.pop("base_url", "https://wfp.openai.azure.com/openai/v1"),
        api_key_encrypted=encrypt_api_key(fields.pop("api_key", SECRET_KEY)),
        api_key_hint="1234",
        check_model=fields.pop("check_model", "gpt-4o-mini"),
        rule_model=fields.pop("rule_model", None),
        status=fields.pop("status", "ok"),
        consecutive_failures=fields.pop("consecutive_failures", 0),
        **fields,
    )
    db.add(connection)
    db.commit()
    return connection


def _survey(db, owner, connection=None):
    survey = SurveyConfig(
        survey_id=uuid4(),
        survey_name=f"Survey {uuid4()}",
        config_data={},
        user_id=owner.user_id,
        ai_connection_id=connection.connection_id if connection else None,
    )
    db.add(survey)
    db.commit()
    return survey


class TestResolveProvider:
    def test_no_connection_means_the_operator_key(self, test_db):
        owner = _user(test_db)
        assert resolve_provider(test_db, _survey(test_db, owner), CHECKS) is None

    def test_the_owners_connection(self, test_db):
        owner = _user(test_db)
        connection = _connection(
            test_db, owner, rule_model="gpt-4o", capabilities={"temperature": False}
        )
        survey = _survey(test_db, owner, connection)

        checks = resolve_provider(test_db, survey, CHECKS)
        assert (checks.api_key, checks.model, checks.base_url) == (
            SECRET_KEY,
            "gpt-4o-mini",
            "https://wfp.openai.azure.com/openai/v1",
        )
        assert checks.connection_id == connection.connection_id
        assert checks.capabilities == Capabilities(temperature=False)
        assert resolve_provider(test_db, survey, RULES).model == "gpt-4o"

    def test_rule_model_falls_back_to_check_model(self, test_db):
        owner = _user(test_db)
        survey = _survey(test_db, owner, _connection(test_db, owner))
        assert resolve_provider(test_db, survey, RULES).model == "gpt-4o-mini"

    def test_someone_elses_connection_is_not_spent(self, test_db):
        owner, other = _user(test_db), _user(test_db, "other@example.invalid")
        survey = _survey(test_db, owner, _connection(test_db, other))
        assert resolve_provider(test_db, survey, CHECKS) is None

    def test_paused_connection_raises_its_error(self, test_db):
        owner = _user(test_db)
        connection = _connection(
            test_db, owner, status=FAILING, last_error="auth: The AI provider rejected the key."
        )
        survey = _survey(test_db, owner, connection)

        with pytest.raises(AIError) as raised:
            resolve_provider(test_db, survey, CHECKS)
        assert raised.value.category == AUTH
        assert "paused" in raised.value.message
        assert paused_error(test_db, survey).startswith("auth: ")

    def test_stored_address_rechecked_at_call_time(self, test_db, monkeypatch):
        """DNS can change after the address was saved."""
        owner = _user(test_db)
        survey = _survey(test_db, owner, _connection(test_db, owner))
        monkeypatch.setattr(ai_endpoints.socket, "getaddrinfo", _resolver("10.0.0.9"))

        with pytest.raises(AIError) as raised:
            resolve_provider(test_db, survey, CHECKS)
        assert raised.value.category == BAD_REQUEST


class TestNoteOutcome:
    def _provider(self, connection):
        return ResolvedProvider(
            api_key="k",
            model="m",
            capabilities=Capabilities(temperature=False),
            connection_id=connection.connection_id,
        )

    def test_success_saves_what_was_learned_and_clears_failures(self, test_db):
        owner = _user(test_db)
        connection = _connection(test_db, owner, consecutive_failures=2, last_error="auth: x")
        note_outcome(test_db, self._provider(connection), "ok")
        test_db.commit()

        assert connection.capabilities["temperature"] is False
        assert (connection.status, connection.consecutive_failures, connection.last_error) == (
            "ok",
            0,
            None,
        )

    def test_three_rejected_keys_pause_it(self, test_db):
        owner = _user(test_db)
        connection = _connection(test_db, owner)
        provider = self._provider(connection)

        for expected in ("ok", "ok", FAILING):
            note_outcome(test_db, provider, AUTH)
            test_db.commit()
            assert connection.status == expected
        assert connection.last_error == "auth: The AI provider rejected the key."

    def test_temporary_failures_do_not_count(self, test_db):
        owner = _user(test_db)
        connection = _connection(test_db, owner)
        for _ in range(5):
            note_outcome(test_db, self._provider(connection), "rate_limited")
        assert (connection.status, connection.consecutive_failures) == ("ok", 0)

    def test_usage_row_names_the_connection(self, test_db):
        owner = _user(test_db)
        connection = _connection(test_db, owner)
        survey = _survey(test_db, owner, connection)
        record = usage_recorder(
            test_db, survey.survey_id, QUALITATIVE_CHECK, provider=self._provider(connection)
        )
        record("m", "ok", 10, 5)

        row = test_db.query(AIUsage).one()
        assert row.connection_id == connection.connection_id


# --- the worker -------------------------------------------------------------------


class TestWorkerUsesTheSurveysProvider:
    @pytest.fixture
    def setup(self, test_db, monkeypatch):
        from sqlalchemy.orm import sessionmaker

        monkeypatch.setattr(
            qualitative_worker_runtime, "SessionLocal", sessionmaker(bind=test_db.get_bind())
        )
        owner = _user(test_db)
        connection = _connection(test_db, owner)
        survey = _survey(test_db, owner, connection)
        survey.config_data = {
            "quality_checks": {
                "flag_llm_qualitative": True,
                "llm_qualitative_fields": ["comments"],
                "llm_check_types": ["relevance"],
            }
        }
        test_db.add(
            SubmissionCurrent(
                _id=1,
                survey_id=survey.survey_id,
                _uuid="uuid-provider",
                _submission_time=datetime(2023, 6, 1),
                end=datetime(2023, 6, 1, 1),
                submission_data={"comments": "Closed market"},
                data_quality_issues=[],
                llm_check_status="pending",
                llm_rules_hash="rules",
                llm_input_hash="input",
            )
        )
        test_db.commit()

        seen = {}

        class FakeAIService:
            qual_check_model = "operator-model"

            def is_available(self):
                return False  # no operator key: the survey's own must be used

            def check_qualitative_responses(self, **kwargs):
                seen["provider"] = kwargs["provider"]
                return []

        monkeypatch.setattr(qualitative_worker_runtime, "AIService", FakeAIService)

        def run():
            payload = {
                "survey_id": str(survey.survey_id),
                "submission_id": 1,
                "llm_rules_hash": "rules",
                "llm_input_hash": "input",
            }
            result = qualitative_worker_runtime.run_qualitative_check_job(payload, "job")
            test_db.expire_all()
            return result, test_db.query(SubmissionCurrent).one()

        return SimpleNamespace(connection=connection, seen=seen, run=run)

    def test_checks_go_to_the_survey_provider(self, setup):
        result, stored = setup.run()
        assert result["status"] == "success"
        assert setup.seen["provider"].connection_id == setup.connection.connection_id
        assert stored.llm_model_used == "gpt-4o-mini"

    def test_paused_provider_is_not_called(self, setup, test_db):
        setup.connection.status = FAILING
        setup.connection.last_error = "provider_quota: The AI provider account is out of credit."
        test_db.commit()

        result, stored = setup.run()
        assert result["category"] == "provider_quota"
        assert "provider" not in setup.seen
        assert stored.llm_check_status == "failed"
        assert stored.llm_last_error.startswith("provider_quota: ")


# --- the HTTP API ---------------------------------------------------------------


class _PassingTest:
    """Stands in for AIClient in the connection test: the endpoint answers."""

    def __init__(self, *_, **__):
        pass

    def complete_json(self, provider, **_):
        provider.capabilities.temperature = False  # as a reasoning model would teach it
        return {"ok": True}


class _FailingTest(_PassingTest):
    def complete_json(self, provider, **_):
        raise AIError(AUTH, "Incorrect API key provided: [key hidden].")


@pytest.fixture
def client(monkeypatch):
    from main import app
    from services.auth import get_current_active_user
    from services.database import get_db
    from tests.test_api_endpoints import engine, override_current_user, override_get_db

    monkeypatch.setattr(ai_providers, "AIClient", _PassingTest)
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_current_user
    with TestClient(app) as test_client:
        test_client.get("/api/surveys")  # creates the test user
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


NEW_CONNECTION = {
    "label": "Our Azure",
    "preset": "azure",
    "base_url": "https://ours.openai.azure.com/openai/v1/",
    "api_key": SECRET_KEY,
    "check_model": "gpt-4o-mini",
}


def _create(client, **overrides):
    response = client.post("/api/ai/connections", json={**NEW_CONNECTION, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


class TestConnectionsApi:
    def test_create_tests_and_never_returns_the_key(self, client):
        created = _create(client)

        assert created["status"] == "ok"
        assert created["test"]["ok"] is True
        assert created["capabilities"]["temperature"] is False
        assert created["api_key_hint"] == "1234"
        assert created["base_url"] == "https://ours.openai.azure.com/openai/v1"
        listed = client.get("/api/ai/connections")
        for text in (str(created), listed.text):
            assert SECRET_KEY not in text
            assert "api_key_encrypted" not in text

    def test_failing_test_still_saves_it_as_failing(self, client, monkeypatch):
        monkeypatch.setattr(ai_providers, "AIClient", _FailingTest)
        created = _create(client)
        assert created["status"] == FAILING
        assert created["test"] == {
            "ok": False,
            "category": AUTH,
            "error": "Incorrect API key provided: [key hidden].",
        }

    def test_private_address_is_refused_before_saving(self, client, monkeypatch):
        monkeypatch.setattr(ai_endpoints.socket, "getaddrinfo", _resolver("169.254.169.254"))
        response = client.post("/api/ai/connections", json=NEW_CONNECTION)
        assert response.status_code == 400
        assert client.get("/api/ai/connections").json() == []

    def test_editing_without_a_key_keeps_it(self, client, test_db):
        created = _create(client)
        response = client.patch(
            f"/api/ai/connections/{created['connection_id']}", json={"label": "Renamed"}
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Renamed"
        assert response.json()["api_key_hint"] == "1234"
        assert "test" not in response.json()  # nothing about the connection changed

    def test_new_key_retests(self, client):
        created = _create(client)
        response = client.patch(
            f"/api/ai/connections/{created['connection_id']}", json={"api_key": "sk-new-9876"}
        )
        assert response.json()["api_key_hint"] == "9876"
        assert response.json()["test"]["ok"] is True

    def test_attach_detach_and_survey_summary(self, client):
        created = _create(client)
        survey = client.post(
            "/api/surveys", json={"survey_name": "With AI", "config_data": {}}
        ).json()

        response = client.put(
            f"/api/surveys/{survey['survey_id']}/ai-connection",
            json={"connection_id": created["connection_id"]},
        )
        assert response.status_code == 200
        summary = client.get(f"/api/surveys/{survey['survey_id']}").json()["ai_connection"]
        assert summary["label"] == "Our Azure"
        assert summary["host"] == "ours.openai.azure.com"
        assert SECRET_KEY not in str(summary)
        listed = client.get("/api/ai/connections").json()[0]
        assert listed["surveys"] == [{"survey_id": survey["survey_id"], "survey_name": "With AI"}]

        client.put(
            f"/api/surveys/{survey['survey_id']}/ai-connection", json={"connection_id": None}
        )
        assert client.get(f"/api/surveys/{survey['survey_id']}").json()["ai_connection"] is None

    def test_deleting_sends_surveys_back_to_the_operator_key(self, client):
        created = _create(client)
        survey = client.post("/api/surveys", json={"survey_name": "S", "config_data": {}}).json()
        client.put(
            f"/api/surveys/{survey['survey_id']}/ai-connection",
            json={"connection_id": created["connection_id"]},
        )

        assert client.delete(f"/api/ai/connections/{created['connection_id']}").status_code == 204
        assert client.get(f"/api/surveys/{survey['survey_id']}").json()["ai_connection"] is None

    def test_someone_elses_connection_is_invisible(self, client):
        from tests.test_api_endpoints import TestingSessionLocal

        db = TestingSessionLocal()
        other = _user(db, "stranger@example.invalid")
        theirs = _connection(db, other)
        their_id = str(theirs.connection_id)
        db.close()

        assert client.get("/api/ai/connections").json() == []
        assert client.post(f"/api/ai/connections/{their_id}/test").status_code == 404
        assert client.delete(f"/api/ai/connections/{their_id}").status_code == 404
        survey = client.post("/api/surveys", json={"survey_name": "S", "config_data": {}}).json()
        response = client.put(
            f"/api/surveys/{survey['survey_id']}/ai-connection", json={"connection_id": their_id}
        )
        assert response.status_code == 404

    def test_retest_resumes_a_paused_connection(self, client):
        from tests.test_api_endpoints import TestingSessionLocal

        created = _create(client)
        db = TestingSessionLocal()
        stored = db.get(AIConnection, UUID(created["connection_id"]))
        stored.status, stored.last_error = FAILING, "auth: The AI provider rejected the key."
        db.commit()
        db.close()

        response = client.post(f"/api/ai/connections/{created['connection_id']}/test")
        assert (response.json()["status"], response.json()["last_error"]) == ("ok", None)

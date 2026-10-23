"""
Error tracking (Sentry) sends nothing that names or reaches a person, and the
health checks tell an uptime monitor when something is down.
"""

import time

import pytest
import redis
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

from services import health, monitoring
from services.monitoring import REDACTED, before_breadcrumb, before_send, scrub_text


class TestScrubbing:
    def test_text(self):
        assert scrub_text("Email to ann.b+x@example.org failed") == f"Email to {REDACTED} failed"
        assert scrub_text("from 203.0.113.7 again") == f"from {REDACTED} again"
        assert (
            scrub_text("DETAIL:  Key (email)=(ann@example.org) already exists.")
            == f"DETAIL:  Key (email)=({REDACTED}) already exists."
        )
        assert (
            scrub_text("https://app.example.org/api/invitations/abc123secret/accept")
            == f"https://app.example.org/api/invitations/{REDACTED}/accept"
        )
        assert scrub_text("survey 5d0c… failed: timeout") == "survey 5d0c… failed: timeout"

    def test_an_event_keeps_what_was_called_never_with_what(self):
        event = {
            "request": {
                "method": "POST",
                "url": "https://app.example.org/api/surveys?token=abc",
                "headers": {"Authorization": "Bearer x", "Cookie": "fc_sign_in=y"},
                "cookies": {"fc_sign_in": "y"},
                "data": {"email": "ann@example.org"},
                "query_string": "token=abc",
                "env": {"REMOTE_ADDR": "203.0.113.7"},
            },
            "user": {"ip_address": "203.0.113.7"},
            "exception": {
                "values": [{"type": "ValueError", "value": "bad address ann@example.org"}]
            },
        }
        sent = before_send(event, {})
        assert sent["request"] == {"method": "POST", "url": "https://app.example.org/api/surveys"}
        assert "user" not in sent
        assert sent["exception"]["values"][0]["value"] == f"bad address {REDACTED}"

    def test_breadcrumbs(self):
        assert (
            before_breadcrumb({"category": "redis", "message": "GET LIMITER/1.2.3.4"}, {}) is None
        )
        crumb = before_breadcrumb(
            {
                "category": "httplib",
                "message": "Email about ann@example.org",
                "data": {"url": "https://kf.kobotoolbox.org/api", "http.query": "token=abc"},
            },
            {},
        )
        assert crumb["message"] == f"Email about {REDACTED}"
        assert crumb["data"] == {"url": "https://kf.kobotoolbox.org/api"}


class TestStarting:
    def test_nothing_without_a_dsn(self, monkeypatch):
        calls = []
        monkeypatch.setattr(sentry_sdk, "init", lambda **options: calls.append(options))
        monkeypatch.delenv("SENTRY_DSN", raising=False)
        assert monitoring.init_sentry("api") is False
        assert calls == []

    def test_options(self, monkeypatch):
        calls = []
        monkeypatch.setattr(sentry_sdk, "init", lambda **options: calls.append(options))
        monkeypatch.setattr(sentry_sdk, "set_tag", lambda *args: None)
        monkeypatch.setenv("SENTRY_DSN", "https://key@o1.ingest.de.sentry.io/2")
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv(
            "BACKEND_IMAGE", "ghcr.io/paulvercoustre/field-compass/field-compass-backend:sha-abc123"
        )

        assert monitoring.init_sentry("worker") is True
        (options,) = calls
        assert options["send_default_pii"] is False
        assert options["include_local_variables"] is False
        assert options["max_request_body_size"] == "never"
        assert (options["environment"], options["release"]) == ("production", "sha-abc123")
        assert "traces_sample_rate" not in options
        reported = {
            type(integration).__name__: integration.failed_request_status_codes
            for integration in options["integrations"]
            if hasattr(integration, "failed_request_status_codes")
        }
        assert set(reported) == {"StarletteIntegration", "FastApiIntegration"}
        assert all(500 in codes and 503 not in codes for codes in reported.values())


class _Captured(Transport):
    events: list = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event":
                _Captured.events.append(item.payload.json)


@pytest.fixture
def real_sentry():
    """The real SDK, sending into a list instead of to Sentry."""
    _Captured.events = []
    sentry_sdk.init(
        dsn="https://key@o1.ingest.de.sentry.io/2",
        transport=_Captured,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=before_send,
        before_breadcrumb=before_breadcrumb,
    )
    yield _Captured.events
    sentry_sdk.init()  # no DSN: sends nothing


def test_a_server_error_reaches_sentry_without_the_request(real_sentry):
    app = FastAPI()

    @app.post("/api/invitations/{token}/accept")
    def accept(token: str):
        raise RuntimeError("could not add ann@example.org")

    TestClient(app, raise_server_exceptions=False).post(
        "/api/invitations/secret-token/accept?x=1",
        headers={"Authorization": "Bearer abc"},
        json={"email": "ann@example.org"},
    )
    sentry_sdk.flush()

    (event,) = real_sentry
    assert set(event["request"]) <= {"method", "url"}
    # The stack quotes the source code around each frame, this test's own
    # included: everything but that must carry nothing from the request.
    exceptions = event.pop("exception")
    assert exceptions["values"][-1]["value"] == f"could not add {REDACTED}"
    sent = str(event)
    assert "secret-token" not in sent and "ann@example.org" not in sent and "Bearer" not in sent
    assert "/api/invitations/[redacted]/accept" in sent


# --- Health -----------------------------------------------------------------------


class _Redis:
    def __init__(self, heartbeat=None, down=False):
        self.heartbeat, self.down, self.stored = heartbeat, down, {}

    def ping(self):
        if self.down:
            raise redis.ConnectionError("down")
        return True

    def get(self, key):
        return self.heartbeat

    def set(self, key, value, ex=None):
        if self.down:
            raise redis.ConnectionError("down")
        self.stored[key] = value


@pytest.fixture
def components(monkeypatch):
    state = {"database": True, "redis": _Redis(heartbeat=str(int(time.time())))}
    monkeypatch.setattr(health, "init_db", lambda: state["database"])
    monkeypatch.setattr(health, "_redis", lambda: state["redis"])
    monkeypatch.setattr(health, "disk_used", lambda: 0.42)
    return state


class TestHealth:
    def test_healthy(self, components):
        result = health.check()
        assert result.healthy
        assert result.as_dict() == {
            "status": "healthy",
            "database": "connected",
            "redis": "connected",
            "scheduled_tasks": "ok",
            "disk": "42% used",
        }

    def test_scheduled_tasks_that_stopped(self, components):
        components["redis"] = _Redis(heartbeat=str(int(time.time()) - 20 * 60))
        assert health.check().as_dict()["scheduled_tasks"] == "stalled"
        assert not health.check().healthy

    def test_no_heartbeat_yet_is_fine_only_just_after_starting(self, components, monkeypatch):
        components["redis"] = _Redis(heartbeat=None)
        assert health.check().scheduled_tasks == "starting"
        assert health.check().healthy
        monkeypatch.setattr(health, "_STARTED", time.time() - 3600)
        assert health.check().scheduled_tasks == "stalled"

    def test_redis_or_database_down(self, components):
        components["redis"] = _Redis(down=True)
        assert health.check().as_dict() == {
            "status": "unhealthy",
            "database": "connected",
            "redis": "disconnected",
            "scheduled_tasks": "unknown",
            "disk": "42% used",
        }
        components["redis"] = _Redis(heartbeat=str(int(time.time())))
        components["database"] = False
        assert not health.check().healthy

    def test_a_disk_almost_full(self, components, monkeypatch):
        monkeypatch.setattr(health, "disk_used", lambda: 0.93)
        result = health.check()
        assert not result.healthy and result.as_dict()["disk"] == "93% used"

    def test_the_sweep_records_a_heartbeat_and_survives_redis_down(self, components):
        health.record_heartbeat()
        assert health.HEARTBEAT_KEY in components["redis"].stored
        components["redis"] = _Redis(down=True)
        health.record_heartbeat()  # logged, not raised

    def test_endpoints_answer_503_when_down(self, components, monkeypatch):
        import main

        monkeypatch.setattr(main, "init_db", lambda: components["database"])
        client = TestClient(main.app)
        assert client.get("/api/health").status_code == 200
        assert client.get("/health").status_code == 200

        components["redis"] = _Redis(down=True)
        response = client.get("/api/health")
        assert response.status_code == 503 and response.json()["redis"] == "disconnected"
        # /health is what deploys wait for: the API and its database only.
        assert client.get("/health").status_code == 200

        components["database"] = False
        assert client.get("/health").status_code == 503

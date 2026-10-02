"""
Connecting a Kobo account: server and API key saved together, only once Kobo
accepts the key.

Kobo itself is replaced by a fake `requests.get`; everything else -- auth,
encryption, the database -- is the real stack from test_auth_endpoints.
"""

import pytest
import requests

from routers import users as users_router
from services.auth import decrypt_api_key
from tests.test_auth_endpoints import GOOD_PASSWORD, client, register  # noqa: F401

GOOD_KEY = "0123456789abcdef0123456789abcdef01234567"


class FakeResponse:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body or {}

    @property
    def ok(self):
        return 200 <= self.status_code < 400

    def json(self):
        return self._body


@pytest.fixture
def kobo(monkeypatch):
    """A fake Kobo that accepts GOOD_KEY on any host; records the URLs called."""
    calls = []
    state = {"assets_status": None, "raise": None}

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(url)
        if state["raise"]:
            raise state["raise"]
        accepted = headers.get("Authorization") == f"Token {GOOD_KEY}"
        if url.endswith("/assets/"):
            return FakeResponse(state["assets_status"] or (200 if accepted else 401))
        if url.endswith("/users/me/"):
            return FakeResponse(200, {"username": "jdoe", "email": "jdoe@example.org"})
        return FakeResponse(404)

    monkeypatch.setattr(users_router.requests, "get", fake_get)
    return {"calls": calls, "state": state}


@pytest.fixture
def auth(client):  # noqa: F811
    register(client)
    token = client.post(
        "/api/auth/login", data={"username": "alice@example.com", "password": GOOD_PASSWORD}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def connect(client, auth, url="https://eu.kobotoolbox.org", key=GOOD_KEY):  # noqa: F811
    return client.put(
        "/api/users/me/kobo-connection",
        json={"kobo_api_url": url, "kobo_api_token": key},
        headers=auth,
    )


def stored_user(client):  # noqa: F811
    from database.models import User

    db = client.db_factory()
    try:
        return db.query(User).filter(User.email == "alice@example.com").one()
    finally:
        db.close()


class TestConnect:
    def test_saves_server_and_key_together(self, client, auth, kobo):  # noqa: F811
        response = connect(client, auth)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user"]["has_kobo_api_key"] is True
        assert body["user"]["kobo_api_url"] == "https://eu.kobotoolbox.org/api/v2"
        assert body["kobo_user"]["username"] == "jdoe"
        assert kobo["calls"][0] == "https://eu.kobotoolbox.org/api/v2/assets/"

        user = stored_user(client)
        assert decrypt_api_key(user.kobo_api_token_encrypted) == GOOD_KEY

    def test_key_is_never_echoed_back(self, client, auth, kobo):  # noqa: F811
        assert GOOD_KEY not in connect(client, auth).text

    @pytest.mark.parametrize(
        "typed",
        [
            "eu.kobotoolbox.org",
            "https://eu.kobotoolbox.org/",
            "https://eu.kobotoolbox.org/api/v2",
            "https://eu.kobotoolbox.org/#/forms/aBcDeFgHiJkLmNoP/summary",
            "  https://eu.kobotoolbox.org  ",
        ],
    )
    def test_server_address_is_normalised(self, client, auth, kobo, typed):  # noqa: F811
        response = connect(client, auth, url=typed)
        assert response.json()["user"]["kobo_api_url"] == "https://eu.kobotoolbox.org/api/v2"

    def test_rejected_key_is_not_saved_and_keeps_the_old_connection(self, client, auth, kobo):  # noqa: F811
        connect(client, auth)

        response = connect(client, auth, url="https://kf.kobotoolbox.org", key="wrong-key-0000000")

        assert response.status_code == 400
        assert "didn't accept" in response.json()["detail"]
        user = stored_user(client)
        assert user.kobo_api_url == "https://eu.kobotoolbox.org/api/v2"
        assert decrypt_api_key(user.kobo_api_token_encrypted) == GOOD_KEY

    def test_short_key_is_rejected_without_calling_kobo(self, client, auth, kobo):  # noqa: F811
        response = connect(client, auth, key="abc")
        assert response.status_code == 400
        assert kobo["calls"] == []

    def test_unreachable_server_says_so(self, client, auth, kobo):  # noqa: F811
        kobo["state"]["raise"] = requests.exceptions.ConnectionError()
        response = connect(client, auth, url="https://kobo.nowhere.example")
        assert response.status_code == 503
        assert "kobo.nowhere.example" in response.json()["detail"]
        assert stored_user(client).kobo_api_token_encrypted is None

    def test_not_a_kobo_server_says_so(self, client, auth, kobo):  # noqa: F811
        kobo["state"]["assets_status"] = 404
        response = connect(client, auth, url="https://example.org")
        assert response.status_code == 400
        assert "No Kobo API found" in response.json()["detail"]

    def test_blank_server_is_rejected(self, client, auth, kobo):  # noqa: F811
        assert connect(client, auth, url="   ").status_code == 400

    def test_requires_sign_in(self, client, kobo):  # noqa: F811
        response = client.put(
            "/api/users/me/kobo-connection",
            json={"kobo_api_url": "https://kf.kobotoolbox.org", "kobo_api_token": GOOD_KEY},
        )
        assert response.status_code == 401


class TestExistingTestEndpoint:
    def test_still_reports_the_kobo_account(self, client, auth, kobo):  # noqa: F811
        connect(client, auth)
        response = client.get("/api/users/me/kobo-api-key/test", headers=auth)
        assert response.status_code == 200
        assert response.json()["kobo_user"]["username"] == "jdoe"

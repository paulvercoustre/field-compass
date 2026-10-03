"""
App events and the admin usage figures, through the real authentication
stack: a signup, a login and the requests after it must each leave the
record the figures are counted from, and deleting things must not erase it.
"""

from datetime import datetime, timedelta

from database.models import AppEvent, User
from services import app_events
from tests import test_auth_endpoints
from tests.test_auth_endpoints import GOOD_PASSWORD, register

# The real, unstubbed authentication stack
client = test_auth_endpoints.client


def _login(client, email="alice@example.com"):
    response = client.post("/api/auth/login/json", json={"email": email, "password": GOOD_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _events(client, kind=None):
    db = client.db_factory()
    try:
        query = db.query(AppEvent)
        if kind:
            query = query.filter(AppEvent.kind == kind)
        return query.all()
    finally:
        db.close()


def _allow_usage(monkeypatch, emails="Alice@Example.com, someone@else.org"):
    monkeypatch.setenv("USAGE_ADMIN_EMAILS", emails)


def test_signup_records_the_campaign_it_came_from(client):
    response = register(
        client,
        signup_source={
            "utm_source": "linkedin",
            "utm_campaign": "launch",
            "password": "not kept",
            "ref": "x" * 500,
        },
    )
    assert response.status_code == 201, response.text

    [event] = _events(client, app_events.SIGNUP)
    assert event.user_id is not None
    assert event.details["utm_source"] == "linkedin"
    assert event.details["utm_campaign"] == "launch"
    assert "password" not in event.details
    assert len(event.details["ref"]) == app_events.SIGNUP_SOURCE_MAX_LENGTH


def test_signup_without_source_still_counts(client):
    assert register(client).status_code == 201
    [event] = _events(client, app_events.SIGNUP)
    assert event.details is None


def test_login_and_first_request_of_the_day_are_recorded_once(client):
    register(client)
    headers = _login(client)
    assert len(_events(client, app_events.LOGIN)) == 1

    for _ in range(3):
        assert client.get("/api/users/me", headers=headers).status_code == 200
    assert len(_events(client, app_events.ACTIVE_DAY)) == 1

    # A new day counts again
    db = client.db_factory()
    db.query(User).update({"last_seen_at": datetime.utcnow() - timedelta(days=1)})
    db.commit()
    db.close()
    client.get("/api/users/me", headers=headers)
    assert len(_events(client, app_events.ACTIVE_DAY)) == 2


def test_survey_created_and_deleted_are_recorded(client):
    register(client)
    headers = _login(client)
    created = client.post("/api/surveys", json={"survey_name": "Baseline"}, headers=headers)
    assert created.status_code == 201, created.text
    survey_id = created.json()["survey_id"]

    assert client.delete(f"/api/surveys/{survey_id}", headers=headers).status_code == 200
    kinds = [e.kind for e in _events(client) if e.survey_id is not None]
    assert kinds == [app_events.SURVEY_CREATED, app_events.SURVEY_DELETED]


def test_deleting_an_account_keeps_its_history(client):
    register(client)
    headers = _login(client)
    assert client.delete("/api/users/me", headers=headers).status_code == 204

    events = _events(client)
    assert {e.kind for e in events} >= {
        app_events.SIGNUP,
        app_events.LOGIN,
        app_events.ACCOUNT_DELETED,
    }
    assert all(e.user_id is None for e in events)


def test_usage_needs_a_listed_email(client, monkeypatch):
    register(client)
    headers = _login(client)
    assert client.get("/api/admin/usage", headers=headers).status_code == 403
    assert client.get("/api/users/me", headers=headers).json()["can_view_usage"] is False


def test_admin_flag_alone_does_not_show_usage(client, monkeypatch):
    """is_admin opens every survey; the figures are a separate, narrower grant."""
    register(client)
    db = client.db_factory()
    db.query(User).update({"is_admin": True})
    db.commit()
    db.close()
    headers = _login(client)
    assert client.get("/api/admin/usage", headers=headers).status_code == 403


def test_listed_email_sees_usage_and_nothing_more(client, monkeypatch):
    _allow_usage(monkeypatch)
    register(client)
    headers = _login(client)
    me = client.get("/api/users/me", headers=headers).json()
    assert me["can_view_usage"] is True
    assert me["is_admin"] is False
    assert client.get("/api/admin/usage", headers=headers).status_code == 200


def test_usage_figures(client, monkeypatch):
    _allow_usage(monkeypatch)
    register(client, signup_source={"utm_source": "linkedin"})
    register(client, email="bob@example.com", username="bob")
    headers = _login(client)
    client.post("/api/surveys", json={"survey_name": "Baseline"}, headers=headers)

    response = client.get("/api/admin/usage", headers=headers)
    assert response.status_code == 200, response.text
    usage = response.json()

    assert usage["totals"]["users"] == 2
    assert usage["totals"]["surveys"] == 1
    assert usage["last_7_days"]["signups"] == 2
    assert usage["last_7_days"]["logins"] == 1
    assert usage["last_7_days"]["active_users"] == 1
    assert usage["last_7_days"]["surveys_created"] == 1
    assert usage["tracking_since"] is not None

    assert len(usage["weekly"]) == 12
    assert usage["weekly"][-1]["signups"] == 2
    assert usage["weekly"][-1]["active_users"] == 1

    assert [step["users"] for step in usage["funnel"]] == [2, 0, 1, 0]
    assert {s["source"]: s["signups"] for s in usage["signup_sources_30_days"]} == {
        "linkedin": 1,
        "direct / unknown": 1,
    }

    by_email = {row["email"]: row for row in usage["recent_signups"]}
    assert by_email["alice@example.com"]["source"] == "linkedin"
    assert by_email["alice@example.com"]["surveys"] == 1
    assert by_email["bob@example.com"]["last_seen_at"] is None

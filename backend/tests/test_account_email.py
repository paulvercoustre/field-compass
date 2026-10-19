"""
Email, and what it makes possible: confirming an address, resetting a
password, and inviting someone to a survey before they have an account.

The endpoints run for real against SQLite; only sending is replaced, by an
outbox the tests read the links from.
"""

import logging
import re
import smtplib
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from database.models import (
    AppEvent,
    Base,
    EmailToken,
    SurveyAccess,
    SurveyInvitation,
    User,
)
from services import account_emails, app_events, mailer
from services.retention_worker import delete_finished_links
from settings import get_settings
from tests.sqlite_compat import sqlite_engine

GOOD_PASSWORD = "Str0ngPassw0rd!23"
NEW_PASSWORD = "An0therPassw0rd!45"


@pytest.fixture
def client():
    engine = sqlite_engine()
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    from main import app
    from services.database import get_db
    from services.rate_limit import limiter

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    limiter.enabled = False
    with TestClient(app) as test_client:
        test_client.db_factory = TestingSessionLocal
        yield test_client
    limiter.enabled = True
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def outbox(monkeypatch):
    sent: list[mailer.Email] = []

    def capture(email: mailer.Email) -> bool:
        sent.append(email)
        return True

    monkeypatch.setattr(mailer, "send", capture)
    return sent


@pytest.fixture
def no_email(monkeypatch):
    """A server with no SMTP_HOST outside development: no email at all."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SMTP_HOST", raising=False)


def register(client, email="alice@example.com", username="alice", **extra):
    payload = {
        "email": email,
        "username": username,
        "password": GOOD_PASSWORD,
        "full_name": username.title(),
        "accept_terms": True,
        **extra,
    }
    return client.post("/api/auth/register", json=payload)


def sign_in(client, email="alice@example.com", password=GOOD_PASSWORD) -> dict[str, str]:
    response = client.post("/api/auth/login", data={"username": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def token_in(email: mailer.Email, path: str) -> str:
    match = re.search(rf"{re.escape(path)}\?token=([A-Za-z0-9_-]+)", email.text)
    assert match, f"no {path} link in: {email.text}"
    return match.group(1)


def mails_to(outbox, address: str) -> list[mailer.Email]:
    return [email for email in outbox if email.to == address]


def confirm(client, *emails: str) -> None:
    db = client.db_factory()
    try:
        for user in db.query(User).filter(User.email.in_(emails)):
            user.email_verified_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def create_survey(client, headers, name="Household survey") -> str:
    response = client.post("/api/surveys", json={"survey_name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["survey_id"]


def share(client, headers, survey_id, email, level="viewer"):
    return client.post(
        f"/api/surveys/{survey_id}/access",
        json={"email": email, "permission_level": level},
        headers=headers,
    )


def survey_ids(client, headers) -> set[str]:
    return {s["survey_id"] for s in client.get("/api/surveys", headers=headers).json()}


def expire(client, model, **filters) -> None:
    db = client.db_factory()
    try:
        for row in db.query(model).filter_by(**filters):
            row.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()


# =============================================================================
# Settings and sending
# =============================================================================


class TestSettings:
    def test_development_prints_production_sends_nothing(self):
        assert get_settings({}).email_backend == "console"
        assert get_settings({"ENVIRONMENT": "production"}).email_backend is None
        assert not get_settings({"ENVIRONMENT": "production"}).email_enabled

    def test_an_smtp_host_sends(self):
        settings = get_settings({"ENVIRONMENT": "production", "SMTP_HOST": "smtp.example.org"})
        assert settings.email_backend == "smtp"
        assert settings.email_enabled

    def test_links_open_app_url_then_site_address_then_the_first_origin(self):
        assert (
            get_settings(
                {"APP_URL": "https://app.example.org/", "SITE_ADDRESS": "https://other.org"}
            ).public_app_url
            == "https://app.example.org"
        )
        assert (
            get_settings({"SITE_ADDRESS": "https://app.example.org"}).public_app_url
            == "https://app.example.org"
        )
        assert (
            get_settings(
                {"SITE_ADDRESS": ":80", "CORS_ORIGINS": "https://app.example.org"}
            ).public_app_url
            == "https://app.example.org"
        )

    def test_an_unknown_security_mode_is_refused(self):
        from settings import SettingsError

        with pytest.raises(SettingsError, match="SMTP_SECURITY"):
            get_settings({"SMTP_SECURITY": "tls"})


class FakeSMTP:
    instances: list["FakeSMTP"] = []
    refuse = False

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.calls, self.sent = host, port, [], []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append(("login", username, password))

    def send_message(self, message):
        if FakeSMTP.refuse:
            raise smtplib.SMTPRecipientsRefused({message["To"]: (550, b"unknown user")})
        self.sent.append(message)


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.instances, FakeSMTP.refuse = [], False
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.example.org")
    monkeypatch.setenv("SMTP_USERNAME", "apikey")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")
    monkeypatch.setenv("EMAIL_FROM", "Field Compass <hello@example.org>")
    monkeypatch.setenv("EMAIL_REPLY_TO", "support@example.org")
    return FakeSMTP


def an_email(to="bob@example.org") -> mailer.Email:
    return mailer.Email(
        to=to, subject="Hello", text="Plain words", html="<p>Plain words</p>", about="user 1"
    )


class TestSending:
    def test_starttls_login_and_both_parts(self, fake_smtp):
        assert mailer.send(an_email()) is True

        server = fake_smtp.instances[0]
        assert (server.host, server.port) == ("smtp.example.org", 587)
        assert server.calls == ["starttls", ("login", "apikey", "secret")]
        message = server.sent[0]
        assert message["From"] == "Field Compass <hello@example.org>"
        assert message["To"] == "bob@example.org"
        assert message["Reply-To"] == "support@example.org"
        assert message["Message-ID"]
        assert message.get_body(("plain",)).get_content().strip() == "Plain words"
        assert "<p>Plain words</p>" in message.get_body(("html",)).get_content()

    def test_ssl_connects_encrypted_without_starttls(self, fake_smtp, monkeypatch):
        monkeypatch.setenv("SMTP_SECURITY", "ssl")
        monkeypatch.setenv("SMTP_PORT", "465")

        assert mailer.send(an_email()) is True
        assert fake_smtp.instances[0].port == 465
        assert "starttls" not in fake_smtp.instances[0].calls

    def test_a_refusal_is_logged_without_the_address(self, fake_smtp, caplog):
        fake_smtp.refuse = True

        with caplog.at_level(logging.ERROR, logger="services.mailer"):
            assert mailer.send(an_email("bob@example.org")) is False
        assert "SMTPRecipientsRefused" in caplog.text
        assert "bob@example.org" not in caplog.text

    def test_without_a_server_nothing_is_sent(self, no_email):
        assert mailer.send(an_email()) is False


class TestMessages:
    def test_names_are_escaped_and_a_survey_name_cannot_break_the_subject(self):
        # Stand-ins, not models: a model built before the first test engine
        # keeps the Postgres column types (tests/sqlite_compat.py).
        inviter = SimpleNamespace(username="eve", full_name="<b>Eve</b>")
        survey = SimpleNamespace(survey_name="Round 2\nBcc: everyone")

        email = account_emails.invitation_email(
            to="bob@example.org",
            invitation_id="inv-1",
            inviter=inviter,
            survey=survey,
            permission_level="editor",
            token="abc",
            valid_for=timedelta(days=14),
        )

        assert "\n" not in email.subject
        assert "<b>Eve</b>" not in email.html
        assert "&lt;b&gt;Eve&lt;/b&gt;" in email.html
        assert "/invite?token=abc" in email.text
        assert "14 days" in email.text
        assert "an editor" in email.text

    def test_durations_read_naturally(self):
        assert account_emails.duration(timedelta(hours=1)) == "1 hour"
        assert account_emails.duration(timedelta(days=3)) == "3 days"


# =============================================================================
# Confirming an address
# =============================================================================


class TestVerification:
    def test_sign_up_sends_a_link_and_the_account_starts_unconfirmed(self, client, outbox):
        response = register(client)

        assert response.status_code == 201, response.text
        assert response.json()["email_verified"] is False
        (email,) = mails_to(outbox, "alice@example.com")
        assert "Confirm" in email.subject
        token_in(email, "/verify-email")

    def test_the_link_confirms_the_address(self, client, outbox):
        register(client)
        token = token_in(outbox[0], "/verify-email")

        response = client.post("/api/auth/verify-email", json={"token": token})

        assert response.status_code == 200, response.text
        assert response.json()["email"] == "alice@example.com"
        me = client.get("/api/users/me", headers=sign_in(client)).json()
        assert me["email_verified"] is True

    def test_the_link_can_be_opened_again(self, client, outbox):
        """A mail scanner opening it first must not leave the person with a dead link."""
        register(client)
        token = token_in(outbox[0], "/verify-email")

        assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
        assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200

    def test_an_unknown_or_expired_link_is_refused(self, client, outbox):
        register(client)
        token = token_in(outbox[0], "/verify-email")
        expire(client, EmailToken, purpose="verify_email")

        for value in (token, "not-a-token"):
            response = client.post("/api/auth/verify-email", json={"token": value})
            assert response.status_code == 400
            assert "expired" in response.json()["detail"]

    def test_asking_again_sends_a_new_link_and_the_old_one_stops(self, client, outbox):
        register(client)
        old = token_in(outbox[0], "/verify-email")

        response = client.post("/api/users/me/verification-email", headers=sign_in(client))

        assert response.json() == {"email_verified": False, "sent_to": "alice@example.com"}
        new = token_in(outbox[-1], "/verify-email")
        assert new != old
        assert client.post("/api/auth/verify-email", json={"token": old}).status_code == 400
        assert client.post("/api/auth/verify-email", json={"token": new}).status_code == 200

    def test_a_confirmed_address_is_not_sent_another(self, client, outbox):
        register(client)
        confirm(client, "alice@example.com")
        outbox.clear()

        response = client.post("/api/users/me/verification-email", headers=sign_in(client))

        assert response.json() == {"email_verified": True}
        assert outbox == []

    def test_without_email_sign_up_sends_nothing(self, client, outbox, no_email):
        assert client.get("/api/auth/options").json() == {"email_enabled": False}

        assert register(client).status_code == 201
        assert outbox == []
        assert (
            client.post("/api/users/me/verification-email", headers=sign_in(client)).status_code
            == 503
        )

    def test_options_say_when_email_works(self, client):
        assert client.get("/api/auth/options").json() == {"email_enabled": True}


# =============================================================================
# Resetting a password
# =============================================================================


class TestPasswordReset:
    def ask(self, client, email="alice@example.com"):
        return client.post("/api/auth/password-reset", json={"email": email})

    def test_a_link_is_sent_to_the_account(self, client, outbox):
        register(client)
        outbox.clear()

        response = self.ask(client, "Alice@Example.com")

        assert response.status_code == 202
        (email,) = outbox
        assert email.to == "alice@example.com"
        token_in(email, "/reset-password")

    def test_an_unknown_address_gets_the_same_answer_and_no_email(self, client, outbox):
        register(client)
        outbox.clear()

        known = self.ask(client)
        unknown = self.ask(client, "nobody@example.com")

        assert unknown.status_code == known.status_code == 202
        assert unknown.json() == known.json()
        assert len(outbox) == 1

    def test_a_disabled_account_gets_no_link(self, client, outbox):
        register(client)
        db = client.db_factory()
        db.query(User).one().is_active = False
        db.commit()
        db.close()
        outbox.clear()

        assert self.ask(client).status_code == 202
        assert outbox == []

    def test_the_link_sets_a_new_password_once(self, client, outbox):
        register(client)
        self.ask(client)
        token = token_in(outbox[-1], "/reset-password")

        response = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD}
        )

        assert response.status_code == 200, response.text
        sign_in(client, password=NEW_PASSWORD)
        old = client.post(
            "/api/auth/login", data={"username": "alice@example.com", "password": GOOD_PASSWORD}
        )
        assert old.status_code == 401
        again = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": GOOD_PASSWORD}
        )
        assert again.status_code == 400

    def test_a_short_password_does_not_spend_the_link(self, client, outbox):
        register(client)
        self.ask(client)
        token = token_in(outbox[-1], "/reset-password")

        short = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": "short"}
        )
        good = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD}
        )

        assert short.status_code == 400
        assert good.status_code == 200

    def test_an_expired_link_is_refused(self, client, outbox):
        register(client)
        self.ask(client)
        token = token_in(outbox[-1], "/reset-password")
        expire(client, EmailToken, purpose="reset_password")

        response = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD}
        )

        assert response.status_code == 400

    def test_asking_twice_leaves_only_the_newest_link(self, client, outbox):
        register(client)
        self.ask(client)
        first = token_in(outbox[-1], "/reset-password")
        self.ask(client)
        second = token_in(outbox[-1], "/reset-password")

        stale = client.post(
            "/api/auth/password-reset/confirm", json={"token": first, "new_password": NEW_PASSWORD}
        )
        fresh = client.post(
            "/api/auth/password-reset/confirm", json={"token": second, "new_password": NEW_PASSWORD}
        )

        assert stale.status_code == 400
        assert fresh.status_code == 200

    def test_a_reset_confirms_the_address(self, client, outbox):
        register(client)
        self.ask(client)
        token = token_in(outbox[-1], "/reset-password")
        client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD}
        )

        me = client.get("/api/users/me", headers=sign_in(client, password=NEW_PASSWORD)).json()
        assert me["email_verified"] is True

    def token_issued(self, client, seconds_ago: int, with_iat: bool = True) -> dict[str, str]:
        """A sign-in made a while ago: tokens record when they were issued, in seconds."""
        from jose import jwt

        from services.auth import ALGORITHM, SECRET_KEY

        db = client.db_factory()
        user = db.query(User).filter(User.email == "alice@example.com").one()
        claims = {
            "sub": str(user.user_id),
            "email": user.email,
            "exp": datetime.utcnow() + timedelta(hours=1),
        }
        db.close()
        if with_iat:
            claims["iat"] = int(datetime.utcnow().timestamp()) - seconds_ago
        return {"Authorization": f"Bearer {jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM)}"}

    def reset(self, client, outbox):
        self.ask(client)
        token = token_in(outbox[-1], "/reset-password")
        response = client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD}
        )
        assert response.status_code == 200, response.text

    def test_a_reset_signs_out_every_earlier_session(self, client, outbox):
        register(client)
        earlier = self.token_issued(client, seconds_ago=60)
        assert client.get("/api/users/me", headers=earlier).status_code == 200

        self.reset(client, outbox)

        assert client.get("/api/users/me", headers=earlier).status_code == 401
        fresh = sign_in(client, password=NEW_PASSWORD)
        assert client.get("/api/users/me", headers=fresh).status_code == 200

    def test_a_sign_in_from_before_tokens_recorded_their_time(self, client, outbox):
        """Tokens minted before this change have no "iat": fine until a reset, refused after."""
        register(client)
        old_style = self.token_issued(client, seconds_ago=0, with_iat=False)
        assert client.get("/api/users/me", headers=old_style).status_code == 200

        self.reset(client, outbox)

        assert client.get("/api/users/me", headers=old_style).status_code == 401

    def test_changing_the_password_in_settings_keeps_the_session(self, client):
        register(client)
        headers = sign_in(client)

        response = client.put(
            "/api/users/me/password",
            json={"current_password": GOOD_PASSWORD, "new_password": NEW_PASSWORD},
            headers=headers,
        )

        assert response.status_code == 200
        assert client.get("/api/users/me", headers=headers).status_code == 200

    def test_without_email_it_says_so(self, client, no_email):
        register(client)

        response = self.ask(client)

        assert response.status_code == 503
        assert "can't send email" in response.json()["detail"]


# =============================================================================
# Sharing and invitations
# =============================================================================


@pytest.fixture
def alice(client):
    """A confirmed owner, with a survey."""
    register(client)
    confirm(client, "alice@example.com")
    headers = sign_in(client)
    return headers, create_survey(client, headers)


class TestSharing:
    def test_a_confirmed_account_gets_access_at_once_and_an_email(self, client, outbox, alice):
        headers, survey_id = alice
        register(client, "bob@example.com", "bob")
        confirm(client, "bob@example.com")
        outbox.clear()

        response = share(client, headers, survey_id, "Bob@Example.com")

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "shared"
        assert survey_id in survey_ids(client, sign_in(client, "bob@example.com"))
        (email,) = mails_to(outbox, "bob@example.com")
        assert email.subject == "Alice shared Household survey with you on Field Compass"
        assert f"/surveys/{survey_id}/submissions" in email.text

    def test_sharing_again_sends_no_second_email(self, client, outbox, alice):
        headers, survey_id = alice
        register(client, "bob@example.com", "bob")
        confirm(client, "bob@example.com")
        share(client, headers, survey_id, "bob@example.com")
        outbox.clear()

        share(client, headers, survey_id, "bob@example.com", "editor")

        assert outbox == []

    def test_an_unconfirmed_account_is_invited_not_given_access(self, client, outbox, alice):
        """Its address may have been registered by someone else."""
        headers, survey_id = alice
        register(client, "bob@example.com", "bob")
        outbox.clear()

        response = share(client, headers, survey_id, "bob@example.com")

        assert response.json()["status"] == "invited"
        assert survey_id not in survey_ids(client, sign_in(client, "bob@example.com"))
        (email,) = mails_to(outbox, "bob@example.com")
        token_in(email, "/invite")

    def test_an_address_with_no_account_is_invited(self, client, outbox, alice):
        headers, survey_id = alice

        response = share(client, headers, survey_id, "carol@example.org", "editor")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "invited"
        assert body["email"] == "carol@example.org"
        assert body["permission_level"] == "editor"
        assert body["expired"] is False
        (email,) = mails_to(outbox, "carol@example.org")
        assert email.subject == "Alice invited you to Household survey on Field Compass"
        listed = client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json()
        assert [i["email"] for i in listed] == ["carol@example.org"]

    def test_inviting_needs_a_confirmed_address(self, client, outbox):
        register(client)
        headers = sign_in(client)
        survey_id = create_survey(client, headers)
        outbox.clear()

        response = share(client, headers, survey_id, "carol@example.org")

        assert response.status_code == 403
        assert "Confirm your own email address" in response.json()["detail"]
        assert outbox == []

    def test_inviting_again_updates_the_one_invitation(self, client, outbox, alice):
        headers, survey_id = alice
        share(client, headers, survey_id, "carol@example.org")
        first = token_in(outbox[-1], "/invite")

        share(client, headers, survey_id, "carol@example.org", "editor")

        listed = client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json()
        assert [(i["email"], i["permission_level"]) for i in listed] == [
            ("carol@example.org", "editor")
        ]
        assert client.get(f"/api/invitations/{first}").status_code == 404

    def test_invitations_are_recorded(self, client, outbox, alice):
        headers, survey_id = alice
        share(client, headers, survey_id, "carol@example.org")

        db = client.db_factory()
        kinds = [e.kind for e in db.query(AppEvent).filter(AppEvent.survey_id == UUID(survey_id))]
        db.close()
        assert app_events.INVITE_SENT in kinds

    def test_without_email_sharing_works_as_before(self, client, outbox, no_email):
        register(client)
        headers = sign_in(client)
        survey_id = create_survey(client, headers)
        register(client, "bob@example.com", "bob")

        unknown = share(client, headers, survey_id, "carol@example.org")
        existing = share(client, headers, survey_id, "bob@example.com")

        assert unknown.status_code == 404
        assert "No account uses carol@example.org" in unknown.json()["detail"]
        assert existing.json()["status"] == "shared"
        assert survey_id in survey_ids(client, sign_in(client, "bob@example.com"))
        assert outbox == []


class TestInvitations:
    @pytest.fixture
    def invited(self, client, outbox, alice):
        """Carol, with no account, invited to Alice's survey as a viewer."""
        headers, survey_id = alice
        share(client, headers, survey_id, "carol@example.org")
        return headers, survey_id, token_in(outbox[-1], "/invite")

    def test_the_link_says_what_it_offers(self, client, invited):
        _, _, token = invited

        response = client.get(f"/api/invitations/{token}")

        assert response.status_code == 200
        assert response.json() == {
            "email": "carol@example.org",
            "survey_name": "Household survey",
            "invited_by": "Alice",
            "permission_level": "viewer",
            "status": "open",
            "account_exists": False,
        }

    def test_signing_up_from_it_confirms_the_address_and_opens_the_survey(
        self, client, outbox, invited
    ):
        _, survey_id, token = invited
        outbox.clear()

        response = register(client, "carol@example.org", "carol", invite_token=token)

        assert response.json()["email_verified"] is True
        assert outbox == []  # no confirmation email: the invitation was one
        carol = sign_in(client, "carol@example.org")
        assert survey_id in survey_ids(client, carol)
        # The page accepts once signed in; that finds it done, and says where.
        accepted = client.post(f"/api/invitations/{token}/accept", headers=carol)
        assert accepted.json() == {"survey_id": survey_id, "survey_name": "Household survey"}
        db = client.db_factory()
        signup = db.query(AppEvent).filter(AppEvent.kind == app_events.SIGNUP).all()[-1]
        db.close()
        assert signup.details == {"ref": "invite"}

    def test_signing_up_with_another_address_neither_confirms_nor_shares(
        self, client, outbox, invited
    ):
        _, survey_id, token = invited
        outbox.clear()

        response = register(client, "mallory@example.org", "mallory", invite_token=token)

        assert response.json()["email_verified"] is False
        assert mails_to(outbox, "mallory@example.org")  # the usual confirmation link
        assert survey_id not in survey_ids(client, sign_in(client, "mallory@example.org"))
        refused = client.post(
            f"/api/invitations/{token}/accept", headers=sign_in(client, "mallory@example.org")
        )
        assert refused.status_code == 403
        assert "Sign in with carol@example.org" in refused.json()["detail"]

    def test_an_existing_account_accepts_and_is_confirmed(self, client, outbox, alice):
        headers, survey_id = alice
        register(client, "bob@example.com", "bob")
        share(client, headers, survey_id, "bob@example.com", "editor")
        token = token_in(mails_to(outbox, "bob@example.com")[-1], "/invite")
        bob = sign_in(client, "bob@example.com")

        response = client.post(f"/api/invitations/{token}/accept", headers=bob)

        assert response.status_code == 200, response.text
        assert survey_id in survey_ids(client, bob)
        assert client.get("/api/users/me", headers=bob).json()["email_verified"] is True
        assert client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json() == []
        db = client.db_factory()
        access = db.query(SurveyAccess).one()
        kinds = {e.kind for e in db.query(AppEvent)}
        db.close()
        assert access.permission_level == "editor"
        assert app_events.INVITE_ACCEPTED in kinds

    def test_confirming_the_address_accepts_what_waits_for_it(self, client, outbox, invited):
        _, survey_id, _ = invited
        register(client, "carol@example.org", "carol")
        token = token_in(mails_to(outbox, "carol@example.org")[-1], "/verify-email")

        response = client.post("/api/auth/verify-email", json={"token": token})

        assert response.json()["surveys_added"] == 1
        assert survey_id in survey_ids(client, sign_in(client, "carol@example.org"))

    def test_accepting_never_lowers_access(self, client, outbox, alice):
        headers, survey_id = alice
        register(client, "bob@example.com", "bob")
        db = client.db_factory()
        bob_id = db.query(User).filter(User.email == "bob@example.com").one().user_id
        db.add(SurveyAccess(survey_id=UUID(survey_id), user_id=bob_id, permission_level="editor"))
        db.commit()
        db.close()
        share(client, headers, survey_id, "bob@example.com", "viewer")
        token = token_in(mails_to(outbox, "bob@example.com")[-1], "/invite")

        client.post(f"/api/invitations/{token}/accept", headers=sign_in(client, "bob@example.com"))

        db = client.db_factory()
        assert db.query(SurveyAccess).one().permission_level == "editor"
        db.close()

    def test_an_expired_invitation_is_refused(self, client, invited):
        _, _, token = invited
        expire(client, SurveyInvitation, email="carol@example.org")
        register(client, "carol@example.org", "carol")
        confirm(client, "carol@example.org")

        assert client.get(f"/api/invitations/{token}").json()["status"] == "expired"
        response = client.post(
            f"/api/invitations/{token}/accept", headers=sign_in(client, "carol@example.org")
        )
        assert response.status_code == 410
        assert "Ask Alice to send it again" in response.json()["detail"]

    def test_withdrawing_kills_the_link(self, client, invited):
        headers, survey_id, token = invited
        (invitation,) = client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json()

        response = client.delete(
            f"/api/surveys/{survey_id}/invitations/{invitation['invitation_id']}", headers=headers
        )

        assert response.status_code == 204
        assert client.get(f"/api/invitations/{token}").status_code == 404
        assert client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json() == []

    def test_resending_gives_a_new_link_and_more_time(self, client, outbox, invited):
        headers, survey_id, old = invited
        expire(client, SurveyInvitation, email="carol@example.org")
        (invitation,) = client.get(f"/api/surveys/{survey_id}/invitations", headers=headers).json()
        assert invitation["expired"] is True

        response = client.post(
            f"/api/surveys/{survey_id}/invitations/{invitation['invitation_id']}/resend",
            headers=headers,
        )

        assert response.status_code == 200, response.text
        assert response.json()["expired"] is False
        new = token_in(outbox[-1], "/invite")
        assert client.get(f"/api/invitations/{old}").status_code == 404
        assert client.get(f"/api/invitations/{new}").json()["status"] == "open"

    def test_only_the_owner_sees_and_manages_invitations(self, client, invited):
        _, survey_id, _ = invited
        register(client, "bob@example.com", "bob")

        response = client.get(
            f"/api/surveys/{survey_id}/invitations", headers=sign_in(client, "bob@example.com")
        )

        assert response.status_code in (403, 404)

    def test_deleting_the_survey_deletes_its_invitations(self, client, invited):
        headers, survey_id, token = invited

        assert client.delete(f"/api/surveys/{survey_id}", headers=headers).status_code in (200, 204)

        assert client.get(f"/api/invitations/{token}").status_code == 404


# =============================================================================
# Clean-up
# =============================================================================


def test_spent_links_and_finished_invitations_are_deleted(client, outbox, alice):
    headers, survey_id = alice
    register(client, "bob@example.com", "bob")
    share(client, headers, survey_id, "carol@example.org")
    share(client, headers, survey_id, "dave@example.org")
    db = client.db_factory()
    long_ago = datetime.utcnow() - timedelta(days=40)
    for token in db.query(EmailToken):
        token.expires_at = long_ago
    db.query(SurveyInvitation).filter(
        SurveyInvitation.email == "carol@example.org"
    ).one().expires_at = long_ago
    db.commit()

    links, finished = delete_finished_links(db)

    assert (links, finished) == (2, 1)  # alice's and bob's confirmation links; carol's invitation
    assert [i.email for i in db.query(SurveyInvitation)] == ["dave@example.org"]
    db.close()

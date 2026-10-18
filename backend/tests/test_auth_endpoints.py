"""
End-to-end tests for the registration and login endpoints.

Why this exists
---------------
test_api_endpoints.py overrides `get_current_active_user` with a stub so its
survey/submission tests can run authenticated. That is reasonable for those
tests, but it meant the authentication endpoints themselves -- register, login,
token issuing, /users/me -- had no coverage at all. A user could not create an
account or log in against production and the whole suite still passed.

These tests drive the real endpoints with no auth override: a request arrives
with credentials, or with a token the login endpoint actually minted, and
nothing is stubbed but the database session.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy.orm import sessionmaker

from database.models import (
    AppEvent,
    Base,
    SubmissionCurrent,
    SubmissionHistory,
    SurveyAccess,
    SurveyConfig,
    User,
)
from services import app_events
from services.auth import TERMS_VERSION
from tests.sqlite_compat import sqlite_engine


@pytest.fixture
def client():
    """Test client with a real (unstubbed) authentication stack."""
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

    # Registration is capped at 10/hour per client address. Every test here
    # shares one address, so without this the later tests would get 429s that
    # have nothing to do with what they are asserting.
    limiter.enabled = False

    with TestClient(app) as test_client:
        test_client.db_factory = TestingSessionLocal
        yield test_client

    limiter.enabled = True
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


GOOD_PASSWORD = "Str0ngPassw0rd!23"


def register(client, **overrides):
    payload = {
        "email": "alice@example.com",
        "username": "alice",
        "password": GOOD_PASSWORD,
        "full_name": "Alice Example",
        "accept_terms": True,
    }
    payload.update(overrides)
    return client.post("/api/auth/register", json=payload)


class TestRegister:
    def test_register_creates_account(self, client):
        """The exact request the signup form sends must return 201, not a 500.

        This is the regression test for the production outage: `users` was
        missing from schema.sql, so this call returned a plain-text 500.
        """
        response = register(client)

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["email"] == "alice@example.com"
        assert body["username"] == "alice"
        assert body["is_active"] is True
        assert body["is_admin"] is False
        assert body["has_kobo_api_key"] is False

    def test_register_records_which_terms_were_accepted(self, client):
        register(client)

        db = client.db_factory()
        try:
            user = db.query(User).filter(User.email == "alice@example.com").one()
            assert user.terms_version == TERMS_VERSION
            assert user.terms_accepted_at is not None
        finally:
            db.close()

    @pytest.mark.parametrize("accepted", [{"accept_terms": False}, {}])
    def test_register_without_accepting_the_terms_is_refused(self, client, accepted):
        payload = {"email": "alice@example.com", "username": "alice", "password": GOOD_PASSWORD}
        response = client.post("/api/auth/register", json=payload | accepted)

        assert response.status_code == 400
        assert "terms of service" in response.json()["detail"]
        db = client.db_factory()
        try:
            assert db.query(User).count() == 0
        finally:
            db.close()

    def test_register_never_leaks_the_password(self, client):
        body = register(client).json()
        assert "password" not in body
        assert "password_hash" not in body
        assert GOOD_PASSWORD not in response_text(body)

    def test_password_is_hashed_not_stored_raw(self, client):
        register(client)
        db = client.db_factory()
        try:
            stored = db.query(User).filter(User.email == "alice@example.com").one()
            assert stored.password_hash != GOOD_PASSWORD
            assert stored.password_hash.startswith("$2")  # bcrypt
        finally:
            db.close()

    def test_email_is_normalised_to_lowercase(self, client):
        body = register(client, email="Alice@Example.COM").json()
        assert body["email"] == "alice@example.com"

    def test_duplicate_email_is_rejected(self, client):
        register(client)
        response = register(client, username="alice2")

        assert response.status_code == 400
        assert response.json()["detail"] == "Email already registered"

    def test_duplicate_username_is_rejected(self, client):
        register(client)
        response = register(client, email="other@example.com")

        assert response.status_code == 400
        assert response.json()["detail"] == "Username already taken"

    def test_duplicate_email_in_different_case_is_rejected_cleanly(self, client):
        """Must be a 400, not a 500.

        The stored address is lower-cased but the duplicate check used to
        compare the raw input, so this second signup passed the check and then
        violated the UNIQUE constraint on users.email -- which reached the user
        as a plain-text 500.
        """
        register(client)
        response = register(client, email="ALICE@example.com", username="alice2")

        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Email already registered"

    def test_short_password_is_rejected(self, client):
        response = register(client, password="short")

        assert response.status_code == 400
        assert "8 characters" in response.json()["detail"]

    def test_missing_field_returns_structured_422(self, client):
        response = client.post("/api/auth/register", json={"email": "a@b.com"})

        assert response.status_code == 422
        # The frontend renders this list; it must stay JSON, not plain text.
        assert isinstance(response.json()["detail"], list)


class TestLogin:
    def test_form_login_returns_a_token(self, client):
        """The OAuth2 form flow is what AuthContext.login actually posts."""
        register(client)

        response = client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": GOOD_PASSWORD},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]

    def test_json_login_returns_a_token(self, client):
        register(client)

        response = client.post(
            "/api/auth/login/json",
            json={"email": "alice@example.com", "password": GOOD_PASSWORD},
        )

        assert response.status_code == 200, response.text
        assert response.json()["access_token"]

    def test_login_accepts_the_email_as_typed(self, client):
        """Registration lower-cases the stored email, so login must match that
        way too -- otherwise anyone who signs up with a capitalised address is
        permanently locked out of their own account."""
        register(client, email="Alice@Example.COM")

        response = client.post(
            "/api/auth/login",
            data={"username": "Alice@Example.COM", "password": GOOD_PASSWORD},
        )

        assert response.status_code == 200, response.text

    def test_a_sign_in_lasts_two_hours(self, client):
        """The privacy notice and the security annex promise 2 hours."""
        register(client)
        before = datetime.utcnow()

        token = client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": GOOD_PASSWORD},
        ).json()["access_token"]

        after = datetime.utcnow()
        expires = datetime.fromtimestamp(jwt.get_unverified_claims(token)["exp"], UTC)
        expires = expires.replace(tzinfo=None)
        # exp is whole seconds, so it can fall up to a second short.
        assert before + timedelta(hours=2, seconds=-1) <= expires <= after + timedelta(hours=2)

    def test_wrong_password_is_401(self, client):
        register(client)

        response = client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": "not-the-password"},
        )

        assert response.status_code == 401
        assert response.json()["detail"] == "Incorrect email or password"

    def test_unknown_email_is_401(self, client):
        response = client.post(
            "/api/auth/login",
            data={"username": "nobody@example.com", "password": GOOD_PASSWORD},
        )

        assert response.status_code == 401
        # Same message as a wrong password: the response must not reveal
        # whether the address has an account.
        assert response.json()["detail"] == "Incorrect email or password"

    def test_disabled_account_is_403(self, client):
        register(client)
        db = client.db_factory()
        try:
            user = db.query(User).filter(User.email == "alice@example.com").one()
            user.is_active = False
            db.commit()
        finally:
            db.close()

        response = client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": GOOD_PASSWORD},
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "Account is disabled"


class TestAuthenticatedAccess:
    def test_token_from_login_authenticates_users_me(self, client):
        """The full round trip the app performs on sign-in."""
        register(client)
        token = client.post(
            "/api/auth/login",
            data={"username": "alice@example.com", "password": GOOD_PASSWORD},
        ).json()["access_token"]

        response = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200, response.text
        assert response.json()["email"] == "alice@example.com"

    def test_users_me_requires_a_token(self, client):
        assert client.get("/api/users/me").status_code == 401

    def test_garbage_token_is_rejected(self, client):
        response = client.get("/api/users/me", headers={"Authorization": "Bearer not-a-real-token"})
        assert response.status_code == 401


def sign_in(client, email: str) -> dict[str, str]:
    token = client.post(
        "/api/auth/login", data={"username": email, "password": GOOD_PASSWORD}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def confirm_email(client, *emails: str) -> None:
    """Mark addresses confirmed: a survey is shared directly only with a confirmed one."""
    db = client.db_factory()
    try:
        for user in db.query(User).filter(User.email.in_(emails)):
            user.email_verified_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def create_survey(client, headers, name: str) -> UUID:
    response = client.post("/api/surveys", json={"survey_name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return UUID(response.json()["survey_id"])


class TestDeleteAccount:
    """
    A deleted account takes the surveys it owns with it. Before, they stayed
    in the database with no owner, respondents' answers and all.
    """

    @pytest.fixture
    def accounts(self, client):
        register(client)
        register(client, email="bob@example.com", username="bob")
        confirm_email(client, "alice@example.com", "bob@example.com")
        return sign_in(client, "alice@example.com"), sign_in(client, "bob@example.com")

    def test_owned_surveys_and_their_submissions_are_deleted(self, client, accounts):
        alice, bob = accounts
        survey_id = create_survey(client, alice, "Alice's survey")
        db = client.db_factory()
        try:
            db.add(
                SubmissionCurrent(
                    _id=1,
                    survey_id=survey_id,
                    _uuid=str(uuid4()),
                    _submission_time=datetime.utcnow(),
                    end=datetime.utcnow(),
                    submission_data={"respondent_name": "A respondent"},
                )
            )
            db.add(
                SubmissionHistory(
                    kobo_id=1, deprecated_uuid=str(uuid4()), data_delta={"age": [30, 31]}
                )
            )
            db.commit()
        finally:
            db.close()
        # Shared, so deleting it reaches past its owner.
        client.post(
            f"/api/surveys/{survey_id}/access",
            json={"email": "bob@example.com", "permission_level": "editor"},
            headers=alice,
        )

        assert client.delete("/api/users/me", headers=alice).status_code == 204

        db = client.db_factory()
        try:
            assert db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).count() == 0
            assert db.query(SubmissionCurrent).count() == 0
            assert db.query(SubmissionHistory).count() == 0
            assert db.query(User).filter(User.email == "alice@example.com").count() == 0
        finally:
            db.close()
        assert client.get(f"/api/surveys/{survey_id}", headers=bob).status_code == 404

    def test_surveys_shared_with_them_stay(self, client, accounts):
        alice, bob = accounts
        survey_id = create_survey(client, bob, "Bob's survey")
        client.post(
            f"/api/surveys/{survey_id}/access",
            json={"email": "alice@example.com", "permission_level": "viewer"},
            headers=bob,
        )

        assert client.delete("/api/users/me", headers=alice).status_code == 204

        response = client.get(f"/api/surveys/{survey_id}", headers=bob)
        assert response.status_code == 200, response.text
        db = client.db_factory()
        try:
            assert db.query(SurveyAccess).filter(SurveyAccess.survey_id == survey_id).count() == 0
        finally:
            db.close()


class TestStaffAccess:
    """
    Admins can open every survey. When their admin rights are all that let
    them in, the day they did is recorded, so a customer can be told.
    """

    @pytest.fixture
    def accounts(self, client):
        register(client)
        register(client, email="carol@example.com", username="carol")
        confirm_email(client, "alice@example.com", "carol@example.com")
        db = client.db_factory()
        try:
            db.query(User).filter(User.email == "carol@example.com").one().is_admin = True
            db.commit()
        finally:
            db.close()
        return sign_in(client, "alice@example.com"), sign_in(client, "carol@example.com")

    def staff_events(self, client) -> list[tuple]:
        db = client.db_factory()
        try:
            return [
                (event.user_id, event.survey_id)
                for event in db.query(AppEvent).filter(
                    AppEvent.kind == app_events.STAFF_SURVEY_ACCESS
                )
            ]
        finally:
            db.close()

    def user_id(self, client, email: str) -> UUID:
        db = client.db_factory()
        try:
            return db.query(User).filter(User.email == email).one().user_id
        finally:
            db.close()

    def test_an_admin_opening_a_customers_survey_is_recorded_once_a_day(self, client, accounts):
        alice, carol = accounts
        survey_id = create_survey(client, alice, "Alice's survey")

        assert client.get(f"/api/surveys/{survey_id}", headers=carol).status_code == 200
        assert client.get(f"/api/surveys/{survey_id}", headers=carol).status_code == 200

        carol_id = self.user_id(client, "carol@example.com")
        assert self.staff_events(client) == [(carol_id, survey_id)]

    def test_the_owner_and_admins_it_is_shared_with_are_not_recorded(self, client, accounts):
        alice, carol = accounts
        survey_id = create_survey(client, alice, "Alice's survey")
        client.post(
            f"/api/surveys/{survey_id}/access",
            json={"email": "carol@example.com", "permission_level": "viewer"},
            headers=alice,
        )
        own_survey = create_survey(client, carol, "Carol's survey")

        assert client.get(f"/api/surveys/{survey_id}", headers=alice).status_code == 200
        assert client.get(f"/api/surveys/{survey_id}", headers=carol).status_code == 200
        assert client.get(f"/api/surveys/{own_survey}", headers=carol).status_code == 200

        assert self.staff_events(client) == []


def response_text(body) -> str:
    import json

    return json.dumps(body)

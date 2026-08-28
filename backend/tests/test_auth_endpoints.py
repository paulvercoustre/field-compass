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

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON, String, TypeDecorator, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import Base, User


def _build_sqlite_engine():
    """SQLite engine with the Postgres-only column types mapped across."""

    class JSONBForSQLite(TypeDecorator):
        impl = JSON
        cache_ok = True

        def load_dialect_impl(self, dialect):
            if dialect.name == "sqlite":
                return dialect.type_descriptor(JSON())
            return dialect.type_descriptor(JSONB())

    class UUIDForSQLite(TypeDecorator):
        impl = String(36)
        cache_ok = True

        def load_dialect_impl(self, dialect):
            if dialect.name == "sqlite":
                return dialect.type_descriptor(String(36))
            return dialect.type_descriptor(PostgresUUID(as_uuid=True))

        def process_bind_param(self, value, dialect):
            if value is None:
                return None
            if dialect.name == "sqlite":
                return str(value) if not isinstance(value, str) else value
            return value

        def process_result_value(self, value, dialect):
            if value is None:
                return None
            if dialect.name == "sqlite":
                return uuid.UUID(value) if isinstance(value, str) else value
            return value

    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSONBForSQLite()
            elif isinstance(column.type, PostgresUUID):
                column.type = UUIDForSQLite()

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect", propagate=True)
    def _set_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


@pytest.fixture
def client():
    """Test client with a real (unstubbed) authentication stack."""
    engine = _build_sqlite_engine()
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


def response_text(body) -> str:
    import json

    return json.dumps(body)

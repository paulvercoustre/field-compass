"""
Unhandled server errors must come back as JSON.

Why this exists
---------------
When the `users` table was missing in production, the API raised, Starlette
returned its default 500 -- the plain-text body "Internal Server Error" -- and
the frontend, which parses every error response with response.json(), showed
users:

    Unexpected token 'I', "Internal S"... is not valid JSON

That message describes the frontend's parser, not the fault, and it sent the
investigation to the wrong side of the stack. Whatever breaks next should say
so in the shape every caller already expects.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import Base


@pytest.fixture
def broken_db_client():
    """A client whose database is missing the tables the endpoint needs.

    This is the production failure reproduced: the app is up and healthy, the
    connection works, but the query has no table to hit.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Deliberately NOT calling Base.metadata.create_all.
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

    # Let the app's own exception handler produce the response instead of the
    # test client re-raising, which is what a real HTTP client would see.
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client

    limiter.enabled = True
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_server_error_is_json_not_plain_text(broken_db_client):
    response = broken_db_client.post(
        "/api/auth/register",
        json={
            "email": "alice@example.com",
            "username": "alice",
            "password": "Str0ngPassw0rd!23",
        },
    )

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")

    # The assertion that matters: this must not raise.
    body = response.json()
    assert body["detail"] == "Internal server error"


def test_server_error_does_not_leak_internals(broken_db_client):
    """The 500 body reaches unauthenticated callers, so it must not carry
    table names, SQL, or connection strings from the exception text."""
    response = broken_db_client.post(
        "/api/auth/login/json",
        json={"email": "alice@example.com", "password": "Str0ngPassw0rd!23"},
    )

    assert response.status_code == 500
    text = response.text.lower()
    for leak in ("traceback", "sqlalchemy", "sqlite", "no such table", "select"):
        assert leak not in text, f"500 response leaked {leak!r}: {response.text}"

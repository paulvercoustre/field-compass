"""
Signing in with Google or Microsoft, end to end through the endpoints.

The provider is faked at the two network calls (the code exchange and its
published keys); everything else runs for real, the ID token's checks
included: it is signed with a key made here and published as the provider's.
"""

from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

import tests.test_account_email as accounts
from database.models import SurveyAccess, User, UserIdentity
from services import sign_in
from tests.test_account_email import (
    GOOD_PASSWORD,
    confirm,
    create_survey,
    mails_to,
    register,
    share,
    token_in,
)
from tests.test_account_email import sign_in as password_sign_in

# The account tests' fixtures: the app on SQLite, and the emails it sends.
client = accounts.client
outbox = accounts.outbox

APP = "http://localhost:3000"
WORK_TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47"


@pytest.fixture(scope="module")
def keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = {
        **RSAAlgorithm.to_jwk(private.public_key(), as_dict=True),
        "alg": "RS256",
        "kid": "test-key",
    }
    return private_pem, {"keys": [public]}


class FakeProvider:
    """What the provider answers: the ID token for the next code exchanged."""

    def __init__(self, private_pem):
        self.private_pem = private_pem
        self.claims: dict = {}
        self.exchanged: list[dict] = []
        self.sign_with = private_pem

    def token(self, chosen, nonce):
        issuer = (
            "https://accounts.google.com"
            if chosen.name == "google"
            else f"https://login.microsoftonline.com/{self.claims.get('tid', WORK_TENANT)}/v2.0"
        )
        claims = {
            "iss": issuer,
            "aud": chosen.client_id,
            "exp": datetime.utcnow() + timedelta(minutes=5),
            "iat": datetime.utcnow(),
            "nonce": nonce,
            **self.claims,
        }
        return jwt.encode(claims, self.sign_with, algorithm="RS256", headers={"kid": "test-key"})


@pytest.fixture
def provider(monkeypatch, keys):
    private_pem, published = keys
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "microsoft-client")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "microsoft-secret")
    monkeypatch.setenv("APP_URL", APP)
    fake = FakeProvider(private_pem)

    async def exchange(chosen, code, verifier):
        fake.exchanged.append({"code": code, "verifier": verifier})
        return {"id_token": fake.token(chosen, fake.nonce)}

    async def published_keys(chosen, refresh=False):
        return published

    monkeypatch.setattr(sign_in, "_exchange_code", exchange)
    monkeypatch.setattr(sign_in, "_jwks", published_keys)
    return fake


def go(client, provider, via="google", next_path="/", **claims):
    """Start a sign-in and come back from the provider; returns the callback's redirect."""
    provider.claims = {"sub": "person-1", **claims}
    started = client.get(
        f"/api/auth/oauth/{via}/start", params={"next": next_path}, follow_redirects=False
    )
    assert started.status_code == 302, started.text
    query = parse_qs(urlsplit(started.headers["location"]).query)
    provider.nonce = query["nonce"][0]
    return client.get(
        f"/api/auth/oauth/{via}/callback",
        params={"code": "the-code", "state": query["state"][0]},
        follow_redirects=False,
    )


def landed(response) -> tuple[str, dict]:
    location = urlsplit(response.headers["location"])
    return location.path, {k: v[0] for k, v in parse_qs(location.query).items()}


def user_named(client, email) -> User | None:
    db = client.db_factory()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            user.identities  # noqa: B018 -- load while the session is open
        return user
    finally:
        db.close()


def bearer(response) -> dict[str, str]:
    assert response.status_code in (200, 201), response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


GOOGLE_ANN = {"email": "Ann@Example.org", "email_verified": True, "name": "Ann Okafor"}


# =============================================================================
# The sign-in page and the trip to the provider
# =============================================================================


def test_the_options_list_the_providers_set_up(client, provider, monkeypatch):
    assert client.get("/api/auth/options").json()["sign_in_providers"] == ["google", "microsoft"]

    monkeypatch.delenv("MICROSOFT_CLIENT_SECRET")
    assert client.get("/api/auth/options").json()["sign_in_providers"] == ["google"]
    assert client.get("/api/auth/oauth/microsoft/start", follow_redirects=False).status_code == 404


def test_the_trip_out_carries_state_nonce_and_pkce(client, provider):
    response = client.get("/api/auth/oauth/google/start", follow_redirects=False)

    location = urlsplit(response.headers["location"])
    query = parse_qs(location.query)
    assert location.netloc == "accounts.google.com"
    assert query["client_id"] == ["google-client"]
    assert query["redirect_uri"] == [f"{APP}/api/auth/oauth/google/callback"]
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] and query["nonce"] and query["code_challenge"]
    cookie = response.headers["set-cookie"]
    assert "fc_sign_in=" in cookie and "HttpOnly" in cookie and "Path=/api/auth/oauth" in cookie


# =============================================================================
# Someone new
# =============================================================================


def test_someone_new_accepts_the_terms_then_has_an_account(client, provider, outbox):
    response = go(client, provider, **GOOGLE_ANN)

    assert landed(response) == ("/finish-sign-up", {"next": "/"})
    assert user_named(client, "ann@example.org") is None
    assert client.get("/api/auth/oauth/pending").json() == {
        "provider": "google",
        "provider_label": "Google",
        "email": "ann@example.org",
        "name": "Ann Okafor",
    }

    refused = client.post("/api/auth/oauth/finish", json={"accept_terms": False})
    assert refused.status_code == 400
    assert "Accept the terms" in refused.json()["detail"]

    headers = bearer(client.post("/api/auth/oauth/finish", json={"accept_terms": True}))
    me = client.get("/api/users/me", headers=headers).json()
    assert (me["email"], me["full_name"], me["username"]) == (
        "ann@example.org",
        "Ann Okafor",
        "ann",
    )
    assert me["email_verified"] is True  # Google vouches for the address
    assert (me["has_password"], me["sign_in_methods"]) == (False, ["google"])
    assert outbox == []  # nothing to confirm
    # The sign-up can't be finished twice.
    assert client.post("/api/auth/oauth/finish", json={"accept_terms": True}).status_code == 400


def test_an_unvouched_address_is_confirmed_by_email(client, provider, outbox):
    go(client, provider, "microsoft", email="bo@contoso.org", tid=WORK_TENANT, name="Bo")

    headers = bearer(client.post("/api/auth/oauth/finish", json={"accept_terms": True}))

    assert client.get("/api/users/me", headers=headers).json()["email_verified"] is False
    assert token_in(mails_to(outbox, "bo@contoso.org")[0], "/verify-email")


def test_an_invitation_finishes_into_its_survey(client, provider, outbox):
    register(client)
    owner = password_sign_in(client)
    confirm(client, "alice@example.com")
    survey_id = create_survey(client, owner)
    share(client, owner, survey_id, "bo@contoso.org")
    invite = token_in(mails_to(outbox, "bo@contoso.org")[0], "/invite")

    response = go(
        client,
        provider,
        "microsoft",
        next_path=f"/invite?token={invite}",
        email="bo@contoso.org",
        tid=WORK_TENANT,
    )
    assert landed(response) == ("/finish-sign-up", {"next": f"/invite?token={invite}"})
    headers = bearer(
        client.post("/api/auth/oauth/finish", json={"accept_terms": True, "invite_token": invite})
    )

    me = client.get("/api/users/me", headers=headers).json()
    assert me["email_verified"] is True  # the invitation reached the address
    db = client.db_factory()
    try:
        assert db.query(SurveyAccess).filter_by(user_id=me["user_id"]).count() == 1
    finally:
        db.close()


def test_without_an_address_there_is_no_account(client, provider):
    response = go(client, provider, "microsoft", tid=WORK_TENANT)

    assert landed(response) == ("/", {"sign_in_error": "no_email"})


# =============================================================================
# Coming back, and existing accounts
# =============================================================================


def test_coming_back_signs_in(client, provider):
    go(client, provider, **GOOGLE_ANN)
    client.post("/api/auth/oauth/finish", json={"accept_terms": True})

    response = go(client, provider, next_path="/surveys/s-1/submissions", **GOOGLE_ANN)

    assert landed(response) == ("/signed-in", {"next": "/surveys/s-1/submissions"})
    headers = bearer(client.post("/api/auth/oauth/session"))
    assert client.get("/api/users/me", headers=headers).json()["email"] == "ann@example.org"
    # Swapped once: the cookie is gone.
    assert client.post("/api/auth/oauth/session").status_code == 401


def test_a_vouched_address_links_the_existing_account(client, provider):
    register(client, "ann@example.org", "ann")

    response = go(client, provider, **GOOGLE_ANN)

    assert landed(response)[0] == "/signed-in"
    user = user_named(client, "ann@example.org")
    assert [i.provider for i in user.identities] == ["google"]
    assert user.email_verified_at is not None
    # The password still works.
    password_sign_in(client, "ann@example.org")


def test_an_unvouched_address_never_takes_over_an_account(client, provider):
    """Anyone can type any address on a Microsoft work account (the "nOAuth" takeover)."""
    register(client, "ann@example.org", "ann")

    response = go(client, provider, "microsoft", email="ann@example.org", tid=WORK_TENANT)

    assert landed(response) == ("/", {"sign_in_error": "account_exists"})
    assert user_named(client, "ann@example.org").identities == []


def test_microsoft_vouches_for_personal_accounts_and_verified_domains(client, provider):
    register(client, "ann@outlook.com", "ann")
    register(client, "bo@contoso.org", "bo")

    personal = go(
        client,
        provider,
        "microsoft",
        sub="p-1",
        email="ann@outlook.com",
        tid=sign_in.MICROSOFT_CONSUMERS_TENANT,
    )
    work = go(
        client,
        provider,
        "microsoft",
        sub="w-1",
        email="bo@contoso.org",
        tid=WORK_TENANT,
        xms_edov=True,
    )

    assert landed(personal)[0] == landed(work)[0] == "/signed-in"


def test_a_disabled_account_stays_out(client, provider):
    go(client, provider, **GOOGLE_ANN)
    client.post("/api/auth/oauth/finish", json={"accept_terms": True})
    db = client.db_factory()
    db.query(User).filter(User.email == "ann@example.org").update({"is_active": False})
    db.commit()
    db.close()

    assert landed(go(client, provider, **GOOGLE_ANN)) == ("/", {"sign_in_error": "disabled"})


# =============================================================================
# What is refused
# =============================================================================


def test_a_callback_without_the_matching_state_is_refused(client, provider):
    provider.claims = {"sub": "person-1", **GOOGLE_ANN}
    client.get("/api/auth/oauth/google/start", follow_redirects=False)

    response = client.get(
        "/api/auth/oauth/google/callback",
        params={"code": "the-code", "state": "forged"},
        follow_redirects=False,
    )

    assert landed(response) == ("/", {"sign_in_error": "expired"})
    assert provider.exchanged == []


def test_cancelling_at_the_provider(client, provider):
    response = client.get(
        "/api/auth/oauth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )

    assert landed(response) == ("/", {"sign_in_error": "cancelled"})


@pytest.mark.parametrize(
    "tamper",
    [
        {"aud": "someone-elses-client"},
        {"iss": "https://evil.example.org"},
        {"nonce": "replayed"},
        {"exp": datetime.utcnow() - timedelta(minutes=1)},
    ],
)
def test_an_id_token_that_doesnt_check_out_is_refused(client, provider, tamper):
    response = go(client, provider, **GOOGLE_ANN, **tamper)

    assert landed(response) == ("/", {"sign_in_error": "failed"})
    assert user_named(client, "ann@example.org") is None


def test_a_token_signed_with_another_key_is_refused(client, provider):
    provider.sign_with = (
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )

    assert landed(go(client, provider, **GOOGLE_ANN)) == ("/", {"sign_in_error": "failed"})


def test_the_exchange_sends_the_verifier_of_the_challenge(client, provider):
    import base64
    import hashlib

    started = client.get("/api/auth/oauth/google/start", follow_redirects=False)
    query = parse_qs(urlsplit(started.headers["location"]).query)
    provider.claims, provider.nonce = {"sub": "person-1", **GOOGLE_ANN}, query["nonce"][0]
    client.get(
        "/api/auth/oauth/google/callback",
        params={"code": "the-code", "state": query["state"][0]},
        follow_redirects=False,
    )

    verifier = provider.exchanged[0]["verifier"]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    assert query["code_challenge"] == [challenge.decode()]


def test_next_never_leaves_the_app(client, provider):
    for target in ("https://evil.example.org", "//evil.example.org", "/\\evil.example.org"):
        response = go(client, provider, next_path=target, **GOOGLE_ANN)
        assert landed(response) == ("/finish-sign-up", {"next": "/"})


# =============================================================================
# Accounts without a password
# =============================================================================


def test_an_account_without_a_password(client, provider, outbox):
    go(client, provider, **GOOGLE_ANN)
    headers = bearer(client.post("/api/auth/oauth/finish", json={"accept_terms": True}))

    # No password to sign in with, or to change. (An empty one isn't a
    # password at all: the form refuses it before anything is checked.)
    response = client.post("/api/auth/login", data={"username": "ann@example.org", "password": ""})
    assert response.status_code == 422
    guessed = {"username": "ann@example.org", "password": "An0therPassw0rd!45"}
    assert client.post("/api/auth/login", data=guessed).status_code == 401
    changed = client.put(
        "/api/users/me/password",
        json={"current_password": "", "new_password": "An0therPassw0rd!45"},
        headers=headers,
    )
    assert changed.status_code == 400 and "no password yet" in changed.json()["detail"]
    # Google can't be removed while it is the only way in.
    assert client.delete("/api/users/me/sign-in/google", headers=headers).status_code == 400

    # "Forgot password?" sets one.
    client.post("/api/auth/password-reset", json={"email": "ann@example.org"})
    token = token_in(mails_to(outbox, "ann@example.org")[-1], "/reset-password")
    client.post(
        "/api/auth/password-reset/confirm", json={"token": token, "new_password": GOOD_PASSWORD}
    )
    headers = password_sign_in(client, "ann@example.org")
    me = client.delete("/api/users/me/sign-in/google", headers=headers).json()
    assert (me["has_password"], me["sign_in_methods"]) == (True, [])
    db = client.db_factory()
    try:
        assert db.query(UserIdentity).count() == 0
    finally:
        db.close()

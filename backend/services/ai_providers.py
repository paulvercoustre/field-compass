"""
Which AI provider a survey's calls go to, and what each call says about it.

A survey uses its owner's own connection when one is attached, and the
operator's key otherwise (``resolve_provider`` returns None for that). Each
call through a connection updates it: what the endpoint turned out to accept
is saved, and repeated rejected-key or out-of-credit failures pause it, so a
pull stops queueing checks that cannot succeed until the owner fixes it.

See docs/specs/ai-provider-overhaul.md, sections 6 and 7.5.
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, fields
from datetime import datetime
from typing import Any

from cryptography.fernet import InvalidToken
from sqlalchemy.orm import Session

from database.models import AIConnection, SurveyConfig
from services.ai_client import AIClient, Capabilities, ResolvedProvider
from services.ai_endpoints import EndpointRejected, validate_base_url
from services.ai_errors import AUTH, BAD_REQUEST, NOT_CONFIGURED, PROVIDER_QUOTA, AIError
from services.auth import decrypt_api_key

logger = logging.getLogger(__name__)

CHECKS = "checks"
RULES = "rules"

OK = "ok"
FAILING = "failing"
UNTESTED = "untested"

# Consecutive rejected-key / out-of-credit failures before a connection is
# paused. More than one, so a single bad response does not stop a pull.
FAILURES_BEFORE_PAUSE = 3

_HEALTH_MESSAGES = {
    AUTH: "The AI provider rejected the key.",
    PROVIDER_QUOTA: "The AI provider account is out of credit.",
}

# Test failures that will recur on every call, so the connection is paused.
# Temporary ones (rate_limited, unavailable, timeout) and an unusable reply
# leave its status as it was.
_PAUSING_TEST_FAILURES = frozenset({AUTH, PROVIDER_QUOTA, BAD_REQUEST, NOT_CONFIGURED})

# Large enough for a reasoning model to think before a two-field answer.
_TEST_MAX_OUTPUT = 1000
# The prompt does not spell this shape out, so only an endpoint that honours
# the requested response format -- or a retry with the shape in the prompt --
# produces it. That way the test learns what real checks will need.
_TEST_SCHEMA = {
    "type": "object",
    "properties": {"connection": {"type": "string", "enum": ["working"]}},
    "required": ["connection"],
    "additionalProperties": False,
}


def _capabilities(stored: dict[str, Any] | None) -> Capabilities:
    known = {f.name for f in fields(Capabilities)}
    return Capabilities(**{k: v for k, v in (stored or {}).items() if k in known})


def survey_connection(db: Session, survey: SurveyConfig) -> AIConnection | None:
    """The survey's own connection, if it has one its owner may use."""
    if not survey.ai_connection_id:
        return None
    connection = db.get(AIConnection, survey.ai_connection_id)
    if connection is None:
        return None
    if connection.owner_user_id != survey.user_id:
        # Only the survey's owner may spend on a connection; after an
        # ownership change the survey falls back to the operator's key.
        logger.warning(
            "Survey %s: connection %s belongs to someone else; using the operator key",
            survey.survey_id,
            connection.connection_id,
        )
        return None
    return connection


def provider_for_connection(connection: AIConnection, purpose: str) -> ResolvedProvider:
    """A connection as AIClient needs it. AIError when it cannot be used as stored."""
    try:
        base_url = validate_base_url(connection.base_url)
    except EndpointRejected as exc:
        raise AIError(BAD_REQUEST, str(exc)) from exc

    api_key = "not-needed"  # keyless self-hosted servers; the SDK wants a string
    if connection.api_key_encrypted:
        try:
            api_key = decrypt_api_key(connection.api_key_encrypted)
        except InvalidToken as exc:
            raise AIError(
                NOT_CONFIGURED, "The stored key can no longer be read. Enter it again."
            ) from exc

    model = connection.check_model
    if purpose == RULES and connection.rule_model:
        model = connection.rule_model
    return ResolvedProvider(
        api_key=api_key,
        model=model,
        base_url=base_url,
        capabilities=_capabilities(connection.capabilities),
        connection_id=connection.connection_id,
    )


def resolve_provider(db: Session, survey: SurveyConfig, purpose: str) -> ResolvedProvider | None:
    """
    The survey's own provider, or None for the operator's key.

    Raises AIError while the survey's connection is paused, with the error
    that paused it, so callers report it instead of calling.
    """
    connection = survey_connection(db, survey)
    if connection is None:
        return None
    if connection.status == FAILING:
        raise paused(connection)
    return provider_for_connection(connection, purpose)


def paused(connection: AIConnection) -> AIError:
    category, _, message = (connection.last_error or "").partition(": ")
    if not message:
        category, message = BAD_REQUEST, connection.last_error or "The AI provider is failing."
    return AIError(category, f"{message} AI review is paused until it is fixed.")


def paused_error(db: Session, survey: SurveyConfig) -> str | None:
    """The stored error for a survey whose own connection is paused, else None."""
    connection = survey_connection(db, survey)
    if connection is not None and connection.status == FAILING:
        return str(paused(connection))[:1000]
    return None


def note_outcome(db: Session, provider: ResolvedProvider | None, outcome: str) -> None:
    """
    Update a connection after one of its calls; the caller commits.

    Saves what the endpoint turned out to accept, clears the failure count on
    success, and pauses the connection after repeated rejected-key or
    out-of-credit failures.
    """
    if provider is None or provider.connection_id is None:
        return
    connection = db.get(AIConnection, provider.connection_id)
    if connection is None:
        return

    learned = asdict(provider.capabilities)
    if connection.capabilities != learned:
        connection.capabilities = learned

    if outcome == OK:
        connection.consecutive_failures = 0
        connection.status = OK
        connection.last_error = None
    elif outcome in _HEALTH_MESSAGES:
        connection.consecutive_failures = (connection.consecutive_failures or 0) + 1
        connection.last_error = f"{outcome}: {_HEALTH_MESSAGES[outcome]}"
        if connection.consecutive_failures >= FAILURES_BEFORE_PAUSE:
            connection.status = FAILING
            logger.warning(
                "AI connection %s paused after %s failures (%s)",
                connection.connection_id,
                connection.consecutive_failures,
                outcome,
            )


def run_connection_test(connection: AIConnection, client: AIClient | None = None) -> dict[str, Any]:
    """
    Send a tiny request and record what happened on the connection.

    Starts from the most capable request profile, so the test also learns
    what this endpoint accepts. The caller commits.
    """
    connection.last_tested_at = datetime.utcnow()
    try:
        provider = provider_for_connection(connection, CHECKS)
        provider.capabilities = Capabilities()
        started = time.monotonic()
        (client or AIClient(timeout=60)).complete_json(
            provider,
            name="connection_test",
            system="You are checking that this connection works.",
            user="Confirm that the connection is working, in the required format.",
            schema=_TEST_SCHEMA,
            max_output=_TEST_MAX_OUTPUT,
        )
    except AIError as error:
        # Pause only for what will keep failing. A rate limit, timeout or
        # outage during a test says nothing lasting about the connection, and
        # pausing on it would stop every check until someone tested again.
        if error.category in _PAUSING_TEST_FAILURES:
            connection.status = FAILING
        connection.last_error = str(error)[:1000]
        return {"ok": False, "category": error.category, "error": error.message}

    connection.capabilities = asdict(provider.capabilities)
    connection.status = OK
    connection.consecutive_failures = 0
    connection.last_error = None
    return {
        "ok": True,
        "latency_ms": round((time.monotonic() - started) * 1000),
        "capabilities": connection.capabilities,
    }

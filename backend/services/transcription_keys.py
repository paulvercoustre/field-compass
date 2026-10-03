"""
Which ElevenLabs key transcribes a survey's recordings.

The survey owner's own key when they chose one for this survey (an AI
connection of kind "transcription", picked in Account settings › AI
integration): no Field Compass limit, their ElevenLabs account pays.
Otherwise the operator's ``ELEVENLABS_API_KEY``, within the included usage.
Editors' keys are never used: the owner decides what a survey spends, as
for AI review.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import requests
from cryptography.fernet import InvalidToken
from sqlalchemy.orm import Session

from database.models import AIConnection, SurveyConfig
from services.ai_errors import short_message
from services.ai_providers import FAILING, FAILURES_BEFORE_PAUSE, OK
from services.auth import decrypt_api_key
from services.transcription_client import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    PERMISSION_NAMES,
    TranscriptionClient,
    error_detail,
)

logger = logging.getLogger(__name__)

REVIEW = "review"
TRANSCRIPTION = "transcription"
ELEVENLABS = "elevenlabs"

OWN = "own"
OPERATOR = "operator"

_HEALTH_MESSAGES = {
    "auth": "ElevenLabs rejected the key.",
    "provider_quota": "The ElevenLabs account is out of credit.",
}


@dataclass(frozen=True)
class TranscriptionKey:
    api_key: str | None
    source: str | None  # "own" | "operator" | None (no key at all)
    connection_id: UUID | None = None
    label: str | None = None
    # Set when this key is known to be refused: recordings are not sent.
    paused_error: str | None = None

    @property
    def available(self) -> bool:
        return self.api_key is not None

    @property
    def counts_against_allowance(self) -> bool:
        return self.source == OPERATOR


def base_url() -> str:
    return (os.getenv("ELEVENLABS_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def model() -> str:
    return os.getenv("TRANSCRIPTION_MODEL") or DEFAULT_MODEL


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


def client_for(key: TranscriptionKey) -> TranscriptionClient:
    return TranscriptionClient(
        api_key=key.api_key,
        base_url=base_url(),
        model=model(),
        zero_retention=_env_flag("ELEVENLABS_ZERO_RETENTION"),
    )


def survey_transcription_connection(db: Session, survey: SurveyConfig) -> AIConnection | None:
    """The survey's own transcription key, if it has one its owner may use."""
    if not survey.transcription_connection_id:
        return None
    connection = db.get(AIConnection, survey.transcription_connection_id)
    if connection is None or connection.kind != TRANSCRIPTION:
        return None
    if connection.owner_user_id != survey.user_id:
        # Only the survey's owner may spend on a key; after an ownership
        # change the survey falls back to the included usage.
        return None
    return connection


def own_key_paused_message(connection: AIConnection) -> str:
    reason = (connection.last_error or "").partition(": ")[2] or "ElevenLabs refused it."
    return (
        f"auth: Your ElevenLabs key “{connection.label}” isn't working: {reason} "
        "Check or replace it in Account settings › AI integration."
    )


def resolve_transcription_key(db: Session, survey: SurveyConfig) -> TranscriptionKey:
    connection = survey_transcription_connection(db, survey)
    if connection is not None:
        try:
            api_key = decrypt_api_key(connection.api_key_encrypted or "") or None
        except (InvalidToken, ValueError):
            api_key = None
        if api_key:
            return TranscriptionKey(
                api_key=api_key,
                source=OWN,
                connection_id=connection.connection_id,
                label=connection.label,
                paused_error=own_key_paused_message(connection)
                if connection.status == FAILING
                else None,
            )

    operator = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    if operator:
        from services.transcription_queue import transcription_paused_error

        return TranscriptionKey(
            api_key=operator, source=OPERATOR, paused_error=transcription_paused_error(db)
        )
    return TranscriptionKey(api_key=None, source=None)


def note_own_key_outcome(db: Session, key: TranscriptionKey, category: str) -> None:
    """
    Update the survey's own key after a call, with the same rule as AI review
    connections: repeated rejected-key or out-of-credit failures pause it, a
    success clears that. Commits.
    """
    if key.source != OWN or key.connection_id is None:
        return
    connection = db.get(AIConnection, key.connection_id)
    if connection is None:
        return
    if category == "ok":
        connection.status = OK
        connection.consecutive_failures = 0
        connection.last_error = None
    elif category in _HEALTH_MESSAGES:
        connection.consecutive_failures = (connection.consecutive_failures or 0) + 1
        connection.last_error = f"{category}: {_HEALTH_MESSAGES[category]}"
        if connection.consecutive_failures >= FAILURES_BEFORE_PAUSE:
            connection.status = FAILING
    db.commit()


# --- Checking a key -------------------------------------------------------------


@dataclass(frozen=True)
class KeyCheck:
    ok: bool
    message: str
    category: str | None = None


def check_key(api_key: str, session: requests.Session | None = None) -> KeyCheck:
    """
    Ask ElevenLabs whether it knows this key, without spending anything.

    ``GET /v1/user`` needs the key's "User: Read" permission. A key limited to
    Speech to Text is refused there with a permission error -- which still
    proves ElevenLabs recognised it, so it is accepted.
    """
    http = session or requests
    try:
        response = http.get(f"{base_url()}/v1/user", headers={"xi-api-key": api_key}, timeout=10)
    except requests.Timeout:
        return KeyCheck(
            False, "ElevenLabs did not answer in time. Try again in a moment.", "timeout"
        )
    except requests.RequestException:
        return KeyCheck(False, "Could not reach ElevenLabs. Try again in a moment.", "unavailable")

    if response.status_code == 200:
        return KeyCheck(True, "ElevenLabs accepted the key.")
    names, message = error_detail(response)
    if names & PERMISSION_NAMES:
        return KeyCheck(True, "ElevenLabs accepted the key.")
    if response.status_code in (401, 403):
        return KeyCheck(False, "ElevenLabs doesn't recognise this key.", "auth")
    if response.status_code >= 500:
        return KeyCheck(
            False, "ElevenLabs had a problem answering. Try again in a moment.", "unavailable"
        )
    return KeyCheck(False, f"ElevenLabs refused the key: {short_message(message)}", "bad_request")


def run_transcription_key_test(connection: AIConnection) -> dict:
    """
    Check a transcription key and record the result on it, the way AI review
    connections record theirs. The caller commits.
    """
    connection.last_tested_at = datetime.utcnow()
    try:
        api_key = decrypt_api_key(connection.api_key_encrypted or "")
    except (InvalidToken, ValueError):
        api_key = ""
    if not api_key:
        connection.status = FAILING
        connection.last_error = (
            "not_configured: The stored key can no longer be read. Enter it again."
        )
        return {"ok": False, "category": "not_configured", "error": "Enter the key again."}

    started = time.monotonic()
    check = check_key(api_key)
    if check.ok:
        connection.status = OK
        connection.consecutive_failures = 0
        connection.last_error = None
        return {"ok": True, "latency_ms": round((time.monotonic() - started) * 1000)}
    # A temporary problem says nothing lasting about the key.
    if check.category in ("auth", "bad_request"):
        connection.status = FAILING
    connection.last_error = f"{check.category}: {check.message}"[:1000]
    return {"ok": False, "category": check.category, "error": check.message}

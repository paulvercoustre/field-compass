"""
ElevenLabs speech-to-text (Scribe): one place that sends a recording and reads
the transcript back.

Separate from ``AIClient``, which speaks OpenAI-compatible chat completions.
The two share error categories (``services.ai_errors``) so stored errors and
UI wording work the same way. Logs the host, model, length and outcome --
never the key, never the audio, never the text.

API: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import requests

from services.ai_errors import (
    AUTH,
    BAD_REQUEST,
    BAD_RESPONSE,
    NOT_CONFIGURED,
    PROVIDER_QUOTA,
    RATE_LIMITED,
    TIMEOUT,
    UNAVAILABLE,
    AIError,
    short_message,
)
from services.audio_files import AudioFile
from services.transcription_languages import normalize_language

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.elevenlabs.io"
DEFAULT_MODEL = "scribe_v2"

# ElevenLabs reports an exhausted account as a "status" in the error body, and
# not always with HTTP 402.
# ElevenLabs names an error three ways: its "type", its "code", and a legacy
# "status". Any of them may say the account is out of credit, or busy.
_QUOTA_NAMES = frozenset(
    {"quota_exceeded", "insufficient_credits", "payment_required", "subscription_required"}
)
_RATE_NAMES = frozenset(
    {
        "too_many_concurrent_requests",
        "system_busy",
        "rate_limit_exceeded",
        "concurrent_limit_exceeded",
        "rate_limit_error",
    }
)
# The key is fine but not allowed to do this (a restricted key).
PERMISSION_NAMES = frozenset(
    {"missing_permissions", "insufficient_permissions", "authorization_error"}
)
_MAX_RETRY_AFTER = 300.0


@dataclass(frozen=True)
class TranscriptResult:
    text: str
    language_code: str | None  # ISO 639-3 where Scribe's code maps to one
    language_probability: float | None
    audio_seconds: float | None
    segments: list[dict[str, Any]] | None = field(default=None)


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


def read_timeout(duration_seconds: float | None) -> float:
    """How long to wait for a transcript: 60 s plus half the recording, at most 15 min."""
    return min(60.0 + 0.5 * (duration_seconds or 120.0), 900.0)


class TranscriptionClient:
    def __init__(
        self,
        api_key: str | None,
        base_url: str | None = None,
        model: str | None = None,
        zero_retention: bool = False,
        session: requests.Session | None = None,
    ):
        self.api_key = (api_key or "").strip() or None
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.model = model or DEFAULT_MODEL
        self.zero_retention = zero_retention
        self.session = session or requests.Session()

    @classmethod
    def from_env(cls) -> TranscriptionClient:
        return cls(
            api_key=os.getenv("ELEVENLABS_API_KEY"),
            base_url=os.getenv("ELEVENLABS_BASE_URL") or None,
            model=os.getenv("TRANSCRIPTION_MODEL") or None,
            zero_retention=_flag("ELEVENLABS_ZERO_RETENTION"),
        )

    @property
    def available(self) -> bool:
        return self.api_key is not None

    @property
    def host(self) -> str:
        return urlparse(self.base_url).netloc

    def transcribe(
        self,
        audio: AudioFile,
        *,
        language: str | None = None,
        diarize: bool = False,
        duration_seconds: float | None = None,
    ) -> TranscriptResult:
        """Transcribe one recording. Raises :class:`AIError` on any failure."""
        if not self.available:
            raise AIError(NOT_CONFIGURED, "Transcription is not set up (ELEVENLABS_API_KEY).")

        data = {
            "model_id": self.model,
            "tag_audio_events": "false",
            "diarize": "true" if diarize else "false",
            "timestamps_granularity": "word" if diarize else "none",
        }
        if language:
            data["language_code"] = language
        params = {"enable_logging": "false"} if self.zero_retention else None

        try:
            with open(audio.path, "rb") as handle:
                response = self.session.post(
                    f"{self.base_url}/v1/speech-to-text",
                    headers={"xi-api-key": self.api_key},
                    params=params,
                    data=data,
                    files={
                        "file": (
                            audio.filename,
                            handle,
                            audio.mimetype or "application/octet-stream",
                        )
                    },
                    timeout=(15.0, read_timeout(duration_seconds)),
                )
        except requests.Timeout as exc:
            self._log("timeout", duration_seconds)
            raise AIError(TIMEOUT, "ElevenLabs did not answer in time.") from exc
        except requests.RequestException as exc:
            self._log("unavailable", duration_seconds)
            raise AIError(UNAVAILABLE, "Could not reach ElevenLabs.") from exc

        if response.status_code >= 400:
            error = classify_response(response)
            self._log(error.category, duration_seconds, response.status_code)
            raise error

        try:
            body = response.json()
        except ValueError as exc:
            self._log("bad_response", duration_seconds, response.status_code)
            raise AIError(BAD_RESPONSE, "ElevenLabs sent a reply that is not JSON.") from exc
        result = parse_result(body, diarize=diarize, fallback_seconds=duration_seconds)
        self._log("ok", result.audio_seconds, response.status_code)
        return result

    def _log(self, outcome: str, seconds: float | None, status: int | None = None) -> None:
        logger.info(
            "Transcription call host=%s model=%s seconds=%s status=%s outcome=%s",
            self.host,
            self.model,
            round(seconds, 1) if seconds is not None else None,
            status,
            outcome,
        )


def error_detail(response: requests.Response) -> tuple[set[str], str]:
    """The names ElevenLabs gives an error (type, code, status) and its message."""
    try:
        body = response.json()
    except ValueError:
        return set(), response.text or f"HTTP {response.status_code}"
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict):
        names = {str(detail[key]).lower() for key in ("type", "code", "status") if detail.get(key)}
        return names, str(detail.get("message") or detail.get("status") or "")
    if isinstance(detail, list) and detail and isinstance(detail[0], dict):
        # FastAPI-style validation errors: [{"loc": [...], "msg": "..."}]
        return set(), str(detail[0].get("msg") or detail[0])
    if isinstance(detail, str):
        return set(), detail
    return set(), response.text or f"HTTP {response.status_code}"


def _retry_after(response: requests.Response) -> float | None:
    try:
        value = float(response.headers.get("retry-after", ""))
    except (TypeError, ValueError):
        return None
    return min(max(value, 0.0), _MAX_RETRY_AFTER)


def classify_response(response: requests.Response) -> AIError:
    names, message = error_detail(response)
    message = short_message(message) or f"HTTP {response.status_code}"
    status = response.status_code
    if status == 402 or names & _QUOTA_NAMES:
        return AIError(PROVIDER_QUOTA, message)
    if status == 429 or names & _RATE_NAMES:
        return AIError(RATE_LIMITED, message, retry_after=_retry_after(response))
    if names & PERMISSION_NAMES:
        return AIError(AUTH, f"The ElevenLabs key isn't allowed to use Speech to Text ({message}).")
    if status in (401, 403):
        return AIError(AUTH, message)
    if status >= 500:
        return AIError(UNAVAILABLE, message, retry_after=_retry_after(response))
    return AIError(BAD_REQUEST, message)


def _segments(words: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Speaker turns: consecutive words from one speaker, joined."""
    turns: list[dict[str, Any]] = []
    for word in words:
        if not isinstance(word, dict) or word.get("type") == "audio_event":
            continue
        speaker = word.get("speaker_id")
        text = str(word.get("text") or "")
        if turns and turns[-1]["speaker"] == speaker:
            turns[-1]["text"] += text
            if word.get("end") is not None:
                turns[-1]["end"] = word.get("end")
        else:
            if word.get("type") == "spacing" and not turns:
                continue
            turns.append(
                {
                    "speaker": speaker,
                    "start": word.get("start"),
                    "end": word.get("end"),
                    "text": text,
                }
            )
    cleaned = [
        {**turn, "text": " ".join(turn["text"].split())} for turn in turns if turn["text"].strip()
    ]
    speakers = {turn["speaker"] for turn in cleaned}
    return cleaned if len(speakers) > 1 else None


def parse_result(
    body: dict[str, Any], *, diarize: bool, fallback_seconds: float | None = None
) -> TranscriptResult:
    if not isinstance(body, dict) or not isinstance(body.get("text", ""), str):
        raise AIError(BAD_RESPONSE, "ElevenLabs sent a reply without a transcript.")
    # A multichannel reply holds one transcript per channel; read the first.
    if "transcripts" in body and isinstance(body["transcripts"], list) and body["transcripts"]:
        first = body["transcripts"][0]
        body = {**first, "audio_duration_secs": body.get("audio_duration_secs")}
    words = body.get("words") if isinstance(body.get("words"), list) else []
    seconds = body.get("audio_duration_secs")
    if not isinstance(seconds, int | float):
        ends = [
            w.get("end")
            for w in words
            if isinstance(w, dict) and isinstance(w.get("end"), int | float)
        ]
        seconds = max(ends) if ends else fallback_seconds
    probability = body.get("language_probability")
    raw_language = body.get("language_code")
    return TranscriptResult(
        text=(body.get("text") or "").strip(),
        language_code=normalize_language(raw_language) or (raw_language or None),
        language_probability=float(probability) if isinstance(probability, int | float) else None,
        audio_seconds=float(seconds) if isinstance(seconds, int | float) else None,
        segments=_segments(words) if diarize and words else None,
    )

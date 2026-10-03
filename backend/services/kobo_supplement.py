"""
Sending transcripts to Kobo as its own transcript of a question.

Kobo stores processing results (transcripts, translations, qualitative
analysis) as a *supplement* to a submission, never in the submission itself.
A manual transcript is accepted when it is created: it becomes the question's
selected transcript, shows in Kobo's data table and exports, and anyone can
correct it in Kobo's processing screen.

    POST  /api/v2/assets/{uid}/advanced-features/          enable it on a question
    PATCH /api/v2/assets/{uid}/advanced-features/{fuid}/   add a language
    GET   /api/v2/assets/{uid}/data/{root_uuid}/supplement/
    PATCH /api/v2/assets/{uid}/data/{root_uuid}/supplement/

Source: kobo/apps/subsequences/README.md in kobotoolbox/kpi. See
docs/specs/audio-transcription.md, section 5.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests

from etl.kobo_fetcher import KoboFetcher
from services.ai_errors import short_message

logger = logging.getLogger(__name__)

MANUAL_TRANSCRIPTION = "manual_transcription"
# Kobo's own transcription (Google). Kobo shows whichever was accepted last.
TRANSCRIPTION_ACTIONS = (MANUAL_TRANSCRIPTION, "automatic_google_transcription")

# Kobo's supplement schema version (SUBSEQUENCES_SCHEMA_VERSION in kpi). A
# setting, so a schema bump on Kobo's side does not need a release here.
DEFAULT_SUPPLEMENT_VERSION = "20250820"

# Failure categories, stored as the prefix of kobo_last_error.
KOBO_PERMISSION = "kobo_permission"
UNSUPPORTED = "unsupported"
BAD_REQUEST = "bad_request"
NOT_FOUND = "not_found"
RETRYABLE = "unavailable"

# How long a question's feature setup is trusted without asking Kobo again.
_FEATURE_CACHE_SECONDS = 600
_feature_cache: dict[tuple[str, str, str, str], float] = {}


def supplement_version() -> str:
    return os.getenv("KOBO_SUPPLEMENT_VERSION") or DEFAULT_SUPPLEMENT_VERSION


class KoboSupplementError(Exception):
    def __init__(self, category: str, message: str, retry_after: float | None = None):
        super().__init__(category, message)
        self.category = category
        self.message = message
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        return self.category == RETRYABLE

    def __str__(self) -> str:
        return f"{self.category}: {self.message}"


def _message(response: requests.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return short_message(response.text or f"HTTP {response.status_code}")
    if isinstance(body, dict):
        for key in ("detail", "error", "message", "non_field_errors"):
            if body.get(key):
                return short_message(body[key])
    return short_message(body)


def _call(
    fetcher: KoboFetcher,
    method: str,
    endpoint: str,
    payload: dict | None = None,
    *,
    missing_means_unsupported: bool = False,
) -> Any:
    try:
        response = fetcher.request_json(method, endpoint, payload)
    except requests.Timeout as exc:
        raise KoboSupplementError(RETRYABLE, "Kobo did not answer in time.") from exc
    except requests.RequestException as exc:
        raise KoboSupplementError(RETRYABLE, "Could not reach Kobo.") from exc

    status = response.status_code
    if status < 400:
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise KoboSupplementError(BAD_REQUEST, "Kobo sent a reply that is not JSON.") from exc
    if status in (401, 403):
        raise KoboSupplementError(
            KOBO_PERMISSION, "Your Kobo account can't edit this project's submissions."
        )
    if status in (404, 405) and missing_means_unsupported:
        raise KoboSupplementError(
            UNSUPPORTED, "This Kobo server doesn't support adding transcripts."
        )
    if status == 404:
        raise KoboSupplementError(NOT_FOUND, "Kobo could not find this submission.")
    if status == 429 or status >= 500:
        retry_after = None
        try:
            retry_after = float(response.headers.get("retry-after", ""))
        except (TypeError, ValueError):
            pass
        raise KoboSupplementError(RETRYABLE, _message(response), retry_after=retry_after)
    raise KoboSupplementError(BAD_REQUEST, _message(response))


def _features(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, dict):
        body = body.get("results", [])
    return [item for item in body or [] if isinstance(item, dict)]


def ensure_transcription_feature(
    fetcher: KoboFetcher, asset_uid: str, question_xpath: str, language: str
) -> None:
    """
    Make sure Kobo accepts manual transcripts in ``language`` for the question:
    enable the feature, or add the language to it.
    """
    key = (fetcher.api_url, asset_uid, question_xpath, language)
    if _feature_cache.get(key, 0) > time.monotonic():
        return

    base = f"/assets/{asset_uid}/advanced-features/"
    existing = None
    for feature in _features(_call(fetcher, "GET", base, missing_means_unsupported=True)):
        if (
            feature.get("action") == MANUAL_TRANSCRIPTION
            and str(feature.get("question_xpath") or "").strip("/") == question_xpath
        ):
            existing = feature
            break

    if existing is None:
        _call(
            fetcher,
            "POST",
            base,
            {
                "question_xpath": question_xpath,
                "action": MANUAL_TRANSCRIPTION,
                "params": [{"language": language}],
            },
            missing_means_unsupported=True,
        )
    else:
        params = [p for p in existing.get("params") or [] if isinstance(p, dict)]
        if language not in {p.get("language") for p in params}:
            _call(
                fetcher,
                "PATCH",
                f"{base}{existing.get('uid')}/",
                {"params": [*params, {"language": language}]},
                missing_means_unsupported=True,
            )
    _feature_cache[key] = time.monotonic() + _FEATURE_CACHE_SECONDS


def _supplement_path(asset_uid: str, root_uuid: str) -> str:
    return f"/assets/{asset_uid}/data/{root_uuid}/supplement/"


def read_supplement(fetcher: KoboFetcher, asset_uid: str, root_uuid: str) -> dict[str, Any]:
    body = _call(fetcher, "GET", _supplement_path(asset_uid, root_uuid))
    return body if isinstance(body, dict) else {}


def selected_manual_version(
    supplement: dict[str, Any], question_xpath: str
) -> dict[str, Any] | None:
    """
    The manual transcript Kobo currently shows for a question: the newest
    version, accepted or not deleted. Manual transcripts are accepted when
    created, so the newest is the selected one.
    """
    question = supplement.get(question_xpath) if isinstance(supplement, dict) else None
    action = question.get(MANUAL_TRANSCRIPTION) if isinstance(question, dict) else None
    versions = action.get("_versions") if isinstance(action, dict) else None
    if not isinstance(versions, list):
        return None
    candidates = [v for v in versions if isinstance(v, dict)]
    if not candidates:
        return None
    return max(candidates, key=lambda v: str(v.get("_dateCreated") or ""))


def selected_transcript(supplement: dict[str, Any], question_xpath: str) -> dict[str, Any] | None:
    """
    The transcript version Kobo shows for a question: the one accepted last,
    typed (or sent by us) or made by Kobo's automatic transcription. A
    deletion is a version too, with no value.
    """
    question = supplement.get(question_xpath) if isinstance(supplement, dict) else None
    if not isinstance(question, dict):
        return None
    accepted: list[tuple[str, dict[str, Any]]] = []
    for action in TRANSCRIPTION_ACTIONS:
        data = question.get(action)
        versions = data.get("_versions") if isinstance(data, dict) else None
        for version in versions if isinstance(versions, list) else []:
            if not isinstance(version, dict):
                continue
            # A typed transcript is accepted when it is created.
            when = version.get("_dateAccepted") or (
                version.get("_dateCreated") if action == MANUAL_TRANSCRIPTION else None
            )
            if when:
                accepted.append((str(when), version))
    if not accepted:
        return None
    return max(accepted, key=lambda item: item[0])[1]


def send_transcript(
    fetcher: KoboFetcher,
    asset_uid: str,
    root_uuid: str,
    question_xpath: str,
    language: str,
    value: str,
) -> str | None:
    """Store ``value`` as the question's manual transcript; returns Kobo's version id."""
    body = _call(
        fetcher,
        "PATCH",
        _supplement_path(asset_uid, root_uuid),
        {
            "_version": supplement_version(),
            question_xpath: {MANUAL_TRANSCRIPTION: {"language": language, "value": value}},
        },
    )
    version = selected_manual_version(body if isinstance(body, dict) else {}, question_xpath)
    return str(version.get("_uuid")) if version and version.get("_uuid") else None

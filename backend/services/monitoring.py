"""
Error tracking: the API and the worker report their errors to Sentry, in a
project in its EU region, when SENTRY_DSN is set. docs/monitoring.md sets it up.

Sentry is a sub-processor (site/privacy/), so what it receives is kept to the
error and where it happened:

- no request bodies, headers, cookies or query strings, and no local variables
  from the stack: that is where names, addresses, tokens and survey answers
  would be;
- email addresses, IP addresses, the values a database error quotes
  ("Key (email)=(...)") and invitation tokens in paths are blanked out of
  everything else;
- no user: Sentry gets no account and no IP address.

Server errors (5xx), failed background tasks and anything logged at ERROR are
reported, except 503: the API answers it when something isn't set up or a
provider is unavailable, and says so to the person. No performance tracing.
"""

from __future__ import annotations

import logging
import re
from typing import Any, cast

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.types import Breadcrumb, BreadcrumbHint, Event, Hint

from settings import get_settings

logger = logging.getLogger(__name__)

REDACTED = "[redacted]"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# psycopg2's "DETAIL:  Key (email)=(ann@example.org) already exists."
_KEY_VALUES = re.compile(r"(Key \([^)]*\)=)\((?:[^()]|\([^)]*\))*\)")
# /api/invitations/<token>: the token is the invitation
_PATH_TOKENS = re.compile(r"(/invitations/)[^/?#\s]+")

# Request fields kept: what was called, never with what.
_REQUEST_KEPT = ("method", "url")
# Breadcrumbs dropped whole: Redis keys hold rate-limit keys (IP addresses).
_CRUMBS_DROPPED = ("redis",)
# Server errors reported; 503 says a feature isn't set up or a provider is down.
_REPORTED_STATUSES = set(range(500, 600)) - {503}


def scrub_text(text: str) -> str:
    text = _KEY_VALUES.sub(rf"\1({REDACTED})", text)
    text = _PATH_TOKENS.sub(rf"\1{REDACTED}", text)
    text = _EMAIL.sub(REDACTED, text)
    return _IPV4.sub(REDACTED, text)


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, dict):
        return {key: _scrub(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(item) for item in value]
    return value


def before_send(event: Event, hint: Hint) -> Event:
    request = event.get("request")
    if isinstance(request, dict):
        kept: dict[str, Any] = {key: request[key] for key in _REQUEST_KEPT if key in request}
        url = kept.get("url")
        if isinstance(url, str):
            kept["url"] = url.split("?", 1)[0]
        event["request"] = kept
    event.pop("user", None)
    return cast(Event, _scrub(event))


def before_breadcrumb(crumb: Breadcrumb, hint: BreadcrumbHint) -> Breadcrumb | None:
    if crumb.get("category") in _CRUMBS_DROPPED:
        return None
    data = crumb.get("data")
    if isinstance(data, dict):
        crumb["data"] = {key: item for key, item in data.items() if "query" not in key}
    return cast(Breadcrumb, _scrub(crumb))


def release() -> str | None:
    """The deployed image's tag (sha-<commit>), which names the release in Sentry."""
    image = get_settings().backend_image or ""
    name = image.rsplit("/", 1)[-1]
    return name.split(":", 1)[1] if ":" in name else None


def init_sentry(component: str) -> bool:
    """Report this process's errors to Sentry, if SENTRY_DSN is set. ``component``: api or worker."""
    settings = get_settings()
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or settings.environment,
        release=release(),
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=before_send,
        before_breadcrumb=before_breadcrumb,
        integrations=[
            # Both, with the same codes: FastAPI's runs on top of Starlette's.
            StarletteIntegration(failed_request_status_codes=_REPORTED_STATUSES),
            FastApiIntegration(failed_request_status_codes=_REPORTED_STATUSES),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    sentry_sdk.set_tag("component", component)
    logger.info("Reporting errors to Sentry (%s)", component)
    return True

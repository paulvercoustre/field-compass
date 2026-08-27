"""
Shared rate limiter.

Lives in its own module so both `main.py` and the routers can import it
without a circular import.

Why this exists: authentication endpoints had no throttling of any kind --
no attempt counter, no lockout, no delay -- so an attacker could run
unlimited online password guessing against a known email address. The AI
endpoints were likewise unthrottled, letting any authenticated user burn the
operator's OpenAI budget in a loop.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _client_key(request: Request) -> str:
    """Identify the caller for rate-limiting purposes.

    Behind a reverse proxy (nginx/Caddy in production) every request appears
    to originate from the proxy, which would put all users in one shared
    bucket. When TRUST_PROXY_HEADERS is enabled we use the left-most entry of
    X-Forwarded-For instead.

    This is opt-in precisely because X-Forwarded-For is caller-supplied: it
    must only be trusted when a proxy we control is guaranteed to overwrite
    it. Leave it unset when the app is exposed directly.
    """
    if os.getenv("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes"):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return get_remote_address(request)


# "memory://" is per-process, which is correct for the single-worker uvicorn
# the compose files run. Point RATELIMIT_STORAGE_URI at redis (e.g.
# redis://redis:6379/1) if you ever scale to multiple workers.
limiter = Limiter(
    key_func=_client_key,
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
)

"""
Which provider addresses the server may call.

A user-supplied base URL makes the server send requests on the user's
behalf. Without a check, it could reach the database, Redis, the cloud
metadata service (169.254.169.254) or anything else on the private network.
So only public HTTPS addresses are allowed, unless the operator opts in to
private ones -- a single-organisation deployment with a self-hosted model
next to it -- with ``AI_ALLOW_PRIVATE_ENDPOINTS=true``.

Checked when a connection is saved and again before each call, since what a
name resolves to can change. Redirects are not followed (see AIClient).
See docs/specs/ai-provider-overhaul.md, section 9.2.
"""

import ipaddress
import os
import socket
from collections.abc import Callable
from urllib.parse import urlsplit

Resolver = Callable[..., list]


class EndpointRejected(ValueError):
    """The address is not one the server will call. The message says why."""


def private_endpoints_allowed() -> bool:
    return os.getenv("AI_ALLOW_PRIVATE_ENDPOINTS", "").lower() in {"1", "true", "yes"}


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def validate_base_url(
    url: str,
    *,
    allow_private: bool | None = None,
    resolve: Resolver | None = None,
) -> str:
    """The URL, tidied, if the server may call it; EndpointRejected if not."""
    if allow_private is None:
        allow_private = private_endpoints_allowed()

    url = (url or "").strip()
    parts = urlsplit(url)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise EndpointRejected("Enter the full address, starting with https://.")
    if parts.scheme == "http" and not allow_private:
        raise EndpointRejected("The address must start with https://.")
    if parts.username or parts.password:
        raise EndpointRejected("Put the key in the API key field, not in the address.")

    try:
        infos = (resolve or socket.getaddrinfo)(
            parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP
        )
    except (socket.gaierror, UnicodeError) as exc:
        raise EndpointRejected(f"Could not find {parts.hostname}.") from exc

    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise EndpointRejected(f"Could not find {parts.hostname}.")
    if not allow_private and not all(_is_public(address) for address in addresses):
        raise EndpointRejected(
            f"{parts.hostname} is a private or local address. Ask the administrator "
            "to allow self-hosted endpoints."
        )
    return url.rstrip("/")

"""
Which Kobo server a survey's data comes from, and which servers may be called.

People connect Kobo's Global or EU server, or their organisation's own one,
by typing its address. The server then calls that address with their API
key, so, like an AI provider's (services/ai_endpoints.py), it must be a
public HTTPS address: anything else could reach the database, Redis or the
cloud metadata service. An operator whose Kobo is on its own network, or a
developer with a local one, allows private addresses with
``KOBO_ALLOW_PRIVATE_SERVERS=true``.

The address is checked when it is saved and again before every request,
each redirect included (Kobo sends recordings from its file storage), since
what a name resolves to can change.

A survey keeps the server its project is on (survey_configs.kobo_api_url).
Its pulls, edit links, approvals and recordings go there, with the key of the
person asking only when their Kobo account is on that same server: a key from
another server would be refused there anyway, and another server's data must
never fill the survey.
"""

import socket
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter

from database.models import SurveyConfig, User
from services.ai_endpoints import Resolver, is_public_address
from settings import get_settings

DEFAULT_KOBO_API_URL = "https://kf.kobotoolbox.org/api/v2"

# How names are looked up; the tests replace it, so no test asks the network.
resolve_host: Resolver = socket.getaddrinfo


class KoboServerRejected(ValueError):
    """The server will not call this address. The message says why."""


class KoboAddressBlocked(requests.exceptions.ConnectionError):
    """A request to Kobo, or a redirect from it, was headed for an address the server won't call."""


class KoboAccessError(Exception):
    """This person can't reach the survey's Kobo project. The message says what to do."""


def private_servers_allowed() -> bool:
    return get_settings().kobo_allow_private_servers


def check_kobo_server(
    url: str,
    *,
    allow_private: bool | None = None,
    resolve: Resolver | None = None,
) -> None:
    """Raises KoboServerRejected unless the server may call this address."""
    if allow_private is None:
        allow_private = private_servers_allowed()

    parts = urlsplit((url or "").strip())
    try:
        port = parts.port
    except ValueError:  # not a number
        port = -1
    if parts.scheme not in ("https", "http") or not parts.hostname or port == -1:
        raise KoboServerRejected(
            "That doesn't look like a server address, e.g. https://kobo.example.org"
        )
    if parts.username or parts.password:
        raise KoboServerRejected("Put the API key in its own field, not in the address.")
    if allow_private:
        return
    if parts.scheme == "http":
        raise KoboServerRejected("The server address must start with https://.")

    host = parts.hostname or ""
    try:
        infos = (resolve or resolve_host)(host, port or 443, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError) as exc:
        raise KoboServerRejected(f"Could not find {host}. Check the server address.") from exc

    addresses = {str(info[4][0]) for info in infos}
    if not addresses or not all(_is_public(address) for address in addresses):
        raise KoboServerRejected(
            f"{host} is a private or local address. Field Compass connects to Kobo "
            "servers on the internet."
        )


def _is_public(address: str) -> bool:
    try:
        return is_public_address(address)
    except ValueError:  # e.g. an IPv6 address with a zone, fe80::1%eth0
        return False


class _PublicAddressAdapter(HTTPAdapter):
    """Checks each request's address before sending it, redirects included."""

    def send(self, request, *args, **kwargs):  # type: ignore[override]
        try:
            check_kobo_server(request.url or "")
        except KoboServerRejected as exc:
            raise KoboAddressBlocked(str(exc), request=request) from exc
        return super().send(request, *args, **kwargs)


def kobo_session() -> requests.Session:
    """A session for calling Kobo that only reaches addresses the server may call."""
    session = requests.Session()
    adapter = _PublicAddressAdapter()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def server_host(api_url: str | None) -> str:
    """The host of a Kobo API URL, as servers are compared: ``eu.kobotoolbox.org``."""
    text = (api_url or "").strip() or DEFAULT_KOBO_API_URL
    if "://" not in text:
        text = f"https://{text}"
    return urlsplit(text).netloc.lower()


def same_server(first: str | None, second: str | None) -> bool:
    return server_host(first) == server_host(second)


def kobo_web_url(api_url: str | None) -> str:
    """Kobo's own site on that server, for links into its pages."""
    text = (api_url or "").strip() or DEFAULT_KOBO_API_URL
    scheme = urlsplit(text).scheme if "://" in text else "https"
    return f"{scheme}://{server_host(text)}"


def user_server(user: User) -> str:
    """The server the user's Kobo account, and so their API key, is on."""
    return (user.kobo_api_url or "").strip() or DEFAULT_KOBO_API_URL


def survey_server(survey: SurveyConfig) -> str:
    """The server the survey's Kobo project is on."""
    return (survey.kobo_api_url or "").strip() or DEFAULT_KOBO_API_URL


def on_survey_server(survey: SurveyConfig, user: User) -> bool:
    """Whether the user's Kobo account, and so their key, is on the survey's server."""
    return same_server(user_server(user), survey_server(survey))


def require_survey_server(survey: SurveyConfig, user: User) -> None:
    """Raises KoboAccessError, saying what to do, unless ``on_survey_server``."""
    if on_survey_server(survey, user):
        return
    survey_host = server_host(survey_server(survey))
    raise KoboAccessError(
        f"This survey's Kobo project is on {survey_host}, and your Kobo account is on "
        f"{server_host(user_server(user))}. Connect your {survey_host} account in "
        "Account settings to use it here."
    )

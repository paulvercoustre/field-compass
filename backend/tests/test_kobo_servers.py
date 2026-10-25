"""
Which Kobo servers the server calls, and which server a survey's data comes
from (services/kobo_servers.py).

A Kobo address is typed by a user and called with their key, so it must be a
public HTTPS address: anything else would let an account make the server
call the database, Redis or the cloud metadata service.
"""

import socket
from types import SimpleNamespace

import pytest
import requests
from requests.adapters import HTTPAdapter

from services import kobo_servers
from services.kobo_servers import (
    DEFAULT_KOBO_API_URL,
    KoboAccessError,
    KoboAddressBlocked,
    KoboServerRejected,
    check_kobo_server,
    kobo_session,
    kobo_web_url,
    require_survey_server,
    same_server,
    server_host,
)
from tests.conftest import PUBLIC_IP


def _resolving(*addresses):
    def resolve(host, port, **_):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in addresses]

    return resolve


class TestCheckKoboServer:
    def test_a_public_https_server_is_called(self):
        check_kobo_server("https://kobo.example.org/api/v2", resolve=_resolving(PUBLIC_IP))

    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",  # the API's own container
            "10.0.0.7",  # the private network
            "172.18.0.4",  # a Docker service: postgres, redis
            "169.254.169.254",  # the cloud metadata service
            "::1",
            "::ffff:169.254.169.254",
        ],
    )
    def test_private_and_local_addresses_are_refused(self, address):
        with pytest.raises(KoboServerRejected, match="private or local"):
            check_kobo_server("https://kobo.example.org", resolve=_resolving(address))

    def test_a_name_with_one_private_address_is_refused(self):
        with pytest.raises(KoboServerRejected):
            check_kobo_server("https://kobo.example.org", resolve=_resolving(PUBLIC_IP, "10.0.0.7"))

    def test_plain_http_is_refused(self):
        with pytest.raises(KoboServerRejected, match="https://"):
            check_kobo_server("http://kobo.example.org", resolve=_resolving(PUBLIC_IP))

    def test_a_key_in_the_address_is_refused(self):
        with pytest.raises(KoboServerRejected, match="API key"):
            check_kobo_server("https://me:key@kobo.example.org", resolve=_resolving(PUBLIC_IP))

    @pytest.mark.parametrize(
        "url", ["", "kobo.example.org", "ftp://kobo.example.org", "https://x:y z"]
    )
    def test_what_is_not_an_address_is_refused(self, url):
        with pytest.raises(KoboServerRejected):
            check_kobo_server(url, resolve=_resolving(PUBLIC_IP))

    def test_an_unknown_name_is_refused(self):
        def fail(*args, **kwargs):
            raise socket.gaierror("no such host")

        with pytest.raises(KoboServerRejected, match="Could not find"):
            check_kobo_server("https://no-such-host.example", resolve=fail)

    def test_the_operator_can_allow_private_servers(self, monkeypatch):
        monkeypatch.setenv("KOBO_ALLOW_PRIVATE_SERVERS", "true")
        check_kobo_server("http://127.0.0.1:8765/api/v2", resolve=_resolving("127.0.0.1"))


def _redirect_to(location):
    """HTTPAdapter.send answering every request with a redirect, nothing on the network."""

    def send(self, request, **kwargs):
        response = requests.Response()
        response.status_code = 302
        response.headers["Location"] = location
        response.url = request.url
        response.request = request
        response._content = b""
        response._content_consumed = True
        return response

    return send


class TestKoboSession:
    def test_a_private_address_is_refused_before_connecting(self, monkeypatch):
        monkeypatch.setattr(kobo_servers, "resolve_host", _resolving("10.0.0.7"))
        with pytest.raises(KoboAddressBlocked):
            kobo_session().get("https://kobo.internal.example/api/v2/assets/")

    def test_a_refusal_is_a_connection_error_to_callers(self):
        # Every caller already handles requests' errors: a refused address is one.
        assert issubclass(KoboAddressBlocked, requests.RequestException)

    def test_kobo_redirecting_to_a_private_address_is_refused(self, monkeypatch):
        """Recordings redirect to Kobo's file storage: each hop is checked, not just the first."""

        def resolve(host, port, **_):
            address = "169.254.169.254" if host == "metadata.internal" else PUBLIC_IP
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]

        monkeypatch.setattr(kobo_servers, "resolve_host", resolve)
        monkeypatch.setattr(HTTPAdapter, "send", _redirect_to("https://metadata.internal/latest/"))
        with pytest.raises(KoboAddressBlocked):
            kobo_session().get("https://kobo.example.org/api/v2/assets/a1/data/1/attachments/2/")


class TestServers:
    @pytest.mark.parametrize(
        ("url", "host"),
        [
            ("https://eu.kobotoolbox.org/api/v2", "eu.kobotoolbox.org"),
            ("https://EU.kobotoolbox.org/api/v2/", "eu.kobotoolbox.org"),
            ("kf.kobotoolbox.org/api/v2", "kf.kobotoolbox.org"),
            (None, "kf.kobotoolbox.org"),
            ("", "kf.kobotoolbox.org"),
        ],
    )
    def test_server_host(self, url, host):
        assert server_host(url) == host

    def test_the_same_server_written_differently_is_the_same(self):
        assert same_server(
            "https://eu.kobotoolbox.org/api/v2", "https://EU.kobotoolbox.org/api/v2/"
        )
        assert same_server(None, DEFAULT_KOBO_API_URL)
        assert not same_server("https://eu.kobotoolbox.org/api/v2", DEFAULT_KOBO_API_URL)

    def test_links_into_kobo_go_to_the_surveys_server(self):
        assert kobo_web_url("https://eu.kobotoolbox.org/api/v2") == "https://eu.kobotoolbox.org"
        assert kobo_web_url(None) == "https://kf.kobotoolbox.org"

    def test_an_account_on_another_server_is_told_which(self):
        survey = SimpleNamespace(kobo_api_url="https://eu.kobotoolbox.org/api/v2")
        user = SimpleNamespace(kobo_api_url="https://kf.kobotoolbox.org/api/v2")
        with pytest.raises(KoboAccessError) as refused:
            require_survey_server(survey, user)  # type: ignore[arg-type]
        assert "eu.kobotoolbox.org" in str(refused.value)
        assert "kf.kobotoolbox.org" in str(refused.value)

    def test_an_account_on_the_surveys_server_reaches_it(self):
        survey = SimpleNamespace(kobo_api_url="https://kobo.ngo.example/api/v2")
        user = SimpleNamespace(kobo_api_url="https://kobo.ngo.example/api/v2")
        require_survey_server(survey, user)  # type: ignore[arg-type]

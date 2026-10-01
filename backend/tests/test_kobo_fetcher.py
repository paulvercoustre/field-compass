"""
Tests for KoboFetcher.get_asset_submissions() reporting why a fetch stopped.

The fetch keeps whatever pages it already has when Kobo stops answering,
rather than raising, so a partial pull is still processed. That made a Kobo
outage indistinguishable from "no new submissions": both returned a list, and
the UI showed a green "0 fetched". `last_fetch_error` is how callers tell them
apart.
"""

from unittest.mock import patch

import requests

from etl.kobo_fetcher import KoboFetcher


def _fetcher() -> KoboFetcher:
    return KoboFetcher(api_token="test-token", api_url="https://kobo.example.org/api/v2")


@patch("etl.kobo_fetcher.time.sleep")
def test_complete_fetch_reports_no_error(_sleep):
    fetcher = _fetcher()
    with patch.object(fetcher, "_make_request", return_value={"results": [{"_id": 1}, {"_id": 2}]}):
        submissions = fetcher.get_asset_submissions("aAsset")

    assert len(submissions) == 2
    assert fetcher.last_fetch_error is None


@patch("etl.kobo_fetcher.time.sleep")
def test_unreachable_kobo_returns_nothing_and_says_why(_sleep):
    fetcher = _fetcher()
    with patch.object(
        fetcher,
        "_make_request",
        side_effect=requests.exceptions.ConnectionError("connection refused"),
    ):
        submissions = fetcher.get_asset_submissions("aAsset")

    assert submissions == []
    assert "connection refused" in fetcher.last_fetch_error


@patch("etl.kobo_fetcher.time.sleep")
def test_failure_part_way_keeps_fetched_pages_and_says_why(_sleep):
    fetcher = _fetcher()
    first_page = {"results": [{"_id": i} for i in range(1000)]}
    with patch.object(
        fetcher,
        "_make_request",
        side_effect=[first_page, requests.exceptions.HTTPError("502 Bad Gateway")],
    ):
        submissions = fetcher.get_asset_submissions("aAsset")

    assert len(submissions) == 1000
    assert "502" in fetcher.last_fetch_error


@patch("etl.kobo_fetcher.time.sleep")
def test_error_is_reset_by_the_next_fetch(_sleep):
    fetcher = _fetcher()
    with patch.object(
        fetcher, "_make_request", side_effect=requests.exceptions.Timeout("timed out")
    ):
        fetcher.get_asset_submissions("aAsset")
    assert fetcher.last_fetch_error is not None

    with patch.object(fetcher, "_make_request", return_value={"results": []}):
        fetcher.get_asset_submissions("aAsset")
    assert fetcher.last_fetch_error is None

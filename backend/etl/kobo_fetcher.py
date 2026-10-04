"""
KoboToolbox API Fetcher
Fetches submissions and audit logs from KoboToolbox API.
"""

import logging
import os
import time
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger(__name__)

# Recordings larger than this are not downloaded: an answer to one question is
# far smaller, and the worker's disk is not a place to fill.
MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024


class KoboFetchError(Exception):
    """
    Kobo could not be read. ``status`` is the HTTP status when Kobo answered.

    Raised instead of returning a partial list, so a failed pull says so
    rather than reporting "0 fetched" as a success.
    """

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def describe_kobo_error(exc: Exception) -> str:
    """A pull failure in words a survey owner can act on."""
    status = getattr(exc, "status", None)
    if status is None and isinstance(exc, requests.HTTPError) and exc.response is not None:
        status = exc.response.status_code
    if status in (401, 403):
        return "Kobo rejected the API key, or this account cannot see the project's data."
    if status == 404:
        return "Kobo could not find this project. Check the project ID in Survey settings."
    if status == 429:
        return "Kobo is limiting requests right now. Try again in a few minutes."
    if status is not None and status >= 500:
        return "Kobo had a problem answering. Try again in a few minutes."
    # A fetch error wraps the requests error it came from.
    if isinstance(exc, requests.ConnectionError | requests.Timeout) or isinstance(
        exc.__cause__, requests.ConnectionError | requests.Timeout
    ):
        return "Could not reach Kobo. Check your connection, or try again in a few minutes."
    return f"Could not read the submissions from Kobo ({exc})."


class KoboFetcher:
    """Fetches data from KoboToolbox API."""

    def __init__(self, api_token: str, api_url: str = "https://kf.kobotoolbox.org/api/v2"):
        """
        Initialize Kobo fetcher.

        Args:
            api_token: KoboToolbox API token
            api_url: Base URL for KoboToolbox API (default: kf.kobotoolbox.org)
        """
        self.api_token = api_token
        self.api_url = api_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Token {api_token}", "Content-Type": "application/json"}
        )

    def _make_request(
        self, endpoint: str, params: dict | None = None, max_retries: int = 3
    ) -> dict[str, Any]:
        """
        Make API request with retry logic.

        Args:
            endpoint: API endpoint (relative to base URL)
            params: Query parameters
            max_retries: Maximum number of retry attempts

        Returns:
            JSON response as dictionary
        """
        url = f"{self.api_url}/{endpoint.lstrip('/')}"

        for attempt in range(max_retries):
            try:
                response = self.session.get(url, params=params, timeout=30)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    wait_time = 2**attempt  # Exponential backoff
                    logger.warning(
                        f"Request failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
                else:
                    logger.error(f"Request failed after {max_retries} attempts: {e}")
                    raise

    def get_asset_submissions(
        self,
        asset_uid: str,
        start: datetime | None = None,
        limit: int = 30000,
        query: dict | None = None,
    ) -> list[dict[str, Any]]:
        """
        Fetch all submissions for a given asset (survey).

        Args:
            asset_uid: KoboToolbox asset UID
            start: Only fetch submissions after this datetime (optional)
            limit: Maximum number of submissions to fetch
            query: Additional query parameters

        Returns:
            List of submission dictionaries
        """
        all_submissions = []

        # Handle None limit - use a large default or no limit
        effective_limit = limit if limit is not None else None

        params = {
            "format": "json",
            "limit": min(effective_limit, 30000)
            if effective_limit is not None
            else 30000,  # Kobo API max is 30000
        }

        if start:
            # Kobo uses format: ?start=2023-10-01T00:00:00
            params["start"] = start.strftime("%Y-%m-%dT%H:%M:%S")

        if query:
            params.update(query)

        offset = 0
        page_size = 1000  # Reasonable page size

        logger.info(f"Fetching submissions for asset {asset_uid}...")

        while effective_limit is None or len(all_submissions) < effective_limit:
            params["start"] = offset
            if effective_limit is not None:
                params["limit"] = min(page_size, effective_limit - len(all_submissions))
            else:
                params["limit"] = page_size

            try:
                response = self._make_request(f"/assets/{asset_uid}/data/", params=params)

                # Kobo API returns results in 'results' key
                submissions = response.get("results", [])

                if not submissions:
                    break

                all_submissions.extend(submissions)
                logger.info(
                    f"Fetched {len(submissions)} submissions (total: {len(all_submissions)})"
                )

                # Check if there are more results
                if len(submissions) < page_size:
                    break

                offset += len(submissions)

                # Rate limiting: be nice to the API
                time.sleep(0.5)

            except requests.RequestException as e:
                # Stopping here used to return what had been read so far as if
                # it were everything: a failed pull looked like "0 fetched".
                logger.error(f"Error fetching submissions: {e}")
                status = (
                    e.response.status_code
                    if isinstance(e, requests.HTTPError) and e.response is not None
                    else None
                )
                raise KoboFetchError(str(e), status=status) from e

        logger.info(f"Total submissions fetched: {len(all_submissions)}")
        if effective_limit is not None:
            return all_submissions[:effective_limit]
        return all_submissions

    def get_submission_audit_url(self, submission: dict[str, Any]) -> str | None:
        """
        Extract audit log URL from submission data.

        Args:
            submission: Submission dictionary from Kobo API

        Returns:
            Audit log URL or None if not available
        """
        # Audit URL is typically in the submission metadata
        return submission.get("_audit_URL") or submission.get("audit_URL")

    def download_audit_log(self, audit_url: str, output_path: str) -> bool:
        """
        Download audit log CSV file.

        Args:
            audit_url: URL to the audit log CSV
            output_path: Local path to save the file

        Returns:
            True if successful, False otherwise
        """
        try:
            response = self.session.get(audit_url, timeout=30, stream=True)
            response.raise_for_status()

            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            with open(output_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            logger.debug(f"Downloaded audit log to {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to download audit log from {audit_url}: {e}")
            return False

    def _same_server(self, url: str) -> bool:
        """Only Kobo's own URLs get the API token."""
        return urlparse(url).netloc == urlparse(self.api_url).netloc

    def attachment_url(self, url: str) -> str:
        """An attachment URL, made absolute and checked to be on this Kobo server."""
        absolute = urljoin(self.api_url + "/", url)
        if not self._same_server(absolute):
            raise KoboFetchError("The recording is not on the configured Kobo server.")
        return absolute

    def download_attachment(
        self, url: str, output_path: str, max_bytes: int = MAX_ATTACHMENT_BYTES
    ) -> int:
        """
        Download a submission attachment (a recording) to ``output_path``.

        Kobo redirects to its file storage; ``requests`` drops the token when
        a redirect changes host, so it never leaves Kobo. Returns the size.
        Raises :class:`KoboFetchError`.
        """
        absolute = self.attachment_url(url)
        try:
            with self.session.get(absolute, timeout=(10, 120), stream=True) as response:
                if response.status_code >= 400:
                    raise KoboFetchError(
                        f"Kobo answered {response.status_code} for the recording.",
                        status=response.status_code,
                    )
                size = 0
                with open(output_path, "wb") as handle:
                    for chunk in response.iter_content(chunk_size=65536):
                        size += len(chunk)
                        if size > max_bytes:
                            raise KoboFetchError(
                                "The recording is too large to transcribe.", status=413
                            )
                        handle.write(chunk)
                return size
        except requests.RequestException as exc:
            raise KoboFetchError(f"Could not download the recording: {exc}") from exc

    def open_attachment(self, url: str, range_header: str | None = None) -> requests.Response:
        """A streaming response for a recording, for the in-app player."""
        headers = {"Range": range_header} if range_header else None
        response = self.session.get(
            self.attachment_url(url), timeout=(10, 60), stream=True, headers=headers
        )
        if response.status_code >= 400:
            status = response.status_code
            response.close()
            raise KoboFetchError(f"Kobo answered {status} for the recording.", status=status)
        return response

    def request_json(
        self, method: str, endpoint: str, payload: dict | None = None, timeout: float = 30
    ) -> requests.Response:
        """One API call, no retries: the caller decides what an error means."""
        url = f"{self.api_url}/{endpoint.lstrip('/')}"
        return self.session.request(method, url, json=payload, timeout=timeout)

    def get_asset_info(self, asset_uid: str) -> dict[str, Any]:
        """
        Get asset (survey) information.

        Args:
            asset_uid: KoboToolbox asset UID

        Returns:
            Asset information dictionary
        """
        return self._make_request(f"/assets/{asset_uid}/")

    def list_survey_assets(self, page_size: int = 100, max_pages: int = 10) -> list[dict[str, Any]]:
        """
        Every survey project the API key can see: owned and shared with it.

        Kobo pages the list and points at the next page with an absolute URL.
        That URL only gets the token while it stays on this server, and the
        page count is capped so a very large account cannot hold a request open.
        """
        page = self._make_request(
            "/assets/",
            params={"q": "asset_type:survey", "limit": page_size, "format": "json"},
        )
        assets: list[dict[str, Any]] = list(page.get("results") or [])
        pages = 1
        while pages < max_pages:
            next_url = page.get("next")
            if not next_url or not self._same_server(next_url):
                break
            response = self.session.get(next_url, timeout=30)
            response.raise_for_status()
            page = response.json()
            assets.extend(page.get("results") or [])
            pages += 1
        return assets

    def get_submission_by_uuid(self, asset_uid: str, submission_uuid: str) -> dict[str, Any] | None:
        """
        Fetch a single submission by UUID.

        Args:
            asset_uid: KoboToolbox asset UID
            submission_uuid: Submission UUID to search for

        Returns:
            Submission dictionary if found, None otherwise
        """
        # Query submissions with UUID filter
        # Kobo API v2 uses MongoDB-style query syntax as JSON string
        import json

        query_dict = {"_uuid": submission_uuid}
        query_json = json.dumps(query_dict)

        params = {"format": "json", "query": query_json, "limit": 1}

        try:
            response = self._make_request(f"/assets/{asset_uid}/data/", params=params)
            submissions = response.get("results", [])

            if submissions:
                return submissions[0]
            return None
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error fetching submission by UUID {submission_uuid}: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response status: {e.response.status_code}")
                logger.error(f"Response body: {e.response.text[:500]}")
            return None
        except Exception as e:
            logger.error(f"Error fetching submission by UUID {submission_uuid}: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return None

    def update_validation_status(
        self, asset_uid: str, submission_id: int, validation_status: str | None
    ) -> dict[str, Any]:
        """
        Update validation status for a submission in KoboToolbox.

        Args:
            asset_uid: KoboToolbox asset UID
            submission_id: Submission ID (_id from Kobo)
            validation_status: One of: 'Approved', 'Not Approved', 'On Hold', or None to clear

        Returns:
            Response from Kobo API (or empty dict for DELETE)
        """
        # Use the validation_status endpoint
        endpoint = f"/assets/{asset_uid}/data/{submission_id}/validation_status/"
        url = f"{self.api_url}/{endpoint.lstrip('/')}"

        # To clear validation status, use DELETE instead of PATCH
        if validation_status is None:
            logger.debug(f"Clearing validation status with DELETE to {url}")
            response = self.session.delete(url, timeout=30)

            # Log response for debugging
            if not response.ok:
                logger.error(
                    f"Kobo API error response: Status {response.status_code}, Body: {response.text[:1000]}"
                )

            response.raise_for_status()
            # DELETE may return empty response
            return {} if not response.content else response.json()
        else:
            # Map labels to Kobo UIDs
            uid_map = {
                "Approved": "validation_status_approved",
                "Not Approved": "validation_status_not_approved",
                "On Hold": "validation_status_on_hold",
            }
            # Build the payload - Kobo expects dot notation key: "validation_status.uid"
            payload = {"validation_status.uid": uid_map.get(validation_status)}

            logger.debug(f"Sending validation status update to {url} with payload: {payload}")

            # Use PATCH to update the validation status
            response = self.session.patch(url, json=payload, timeout=30)

            # Log response for debugging
            if not response.ok:
                logger.error(
                    f"Kobo API error response: Status {response.status_code}, Body: {response.text[:1000]}"
                )

            response.raise_for_status()
            return response.json()


def create_fetcher_from_env() -> KoboFetcher:
    """
    Create KoboFetcher instance from environment variables.

    Returns:
        Configured KoboFetcher instance

    Raises:
        ValueError: If required environment variables are missing
    """
    api_token = os.getenv("KOBO_API_TOKEN")
    api_url = os.getenv("KOBO_API_URL", "https://kf.kobotoolbox.org/api/v2")

    if not api_token:
        raise ValueError("KOBO_API_TOKEN environment variable is required")

    return KoboFetcher(api_token=api_token, api_url=api_url)

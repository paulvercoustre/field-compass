"""
Audit Log Processor
Downloads and processes KoboToolbox audit logs to calculate active interview time.
"""

import csv
import logging
import os
import re
from typing import TYPE_CHECKING, Any

from settings import get_settings

if TYPE_CHECKING:
    from etl.kobo_fetcher import KoboFetcher

logger = logging.getLogger(__name__)

# What a Kobo _uuid looks like. It names the file, so nothing else may: the
# submission comes from the Kobo server, and `../x` would write elsewhere.
_SAFE_UUID = re.compile(r"[A-Za-z0-9_-]{1,64}")

# Default audit directory (relative to backend directory)
DEFAULT_AUDIT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "audits")


def get_audit_dir() -> str:
    """
    Get the audit directory path.

    Returns:
        Path to audit directory
    """
    audit_dir = get_settings().audit_dir or DEFAULT_AUDIT_DIR
    # Create directory if it doesn't exist
    os.makedirs(audit_dir, exist_ok=True)
    return audit_dir


def download_audit_log(audit_url: str, uuid: str, fetcher: "KoboFetcher") -> str | None:
    """
    Download a single audit log CSV file from Kobo.

    Args:
        audit_url: URL to the audit log CSV
        uuid: Submission UUID (used as filename)
        fetcher: The pull's Kobo fetcher: its key goes to its own server only

    Returns:
        Path to downloaded file, or None if download failed
    """
    if not audit_url:
        logger.debug(f"No audit URL provided for {uuid}")
        return None
    if not _SAFE_UUID.fullmatch(uuid or ""):
        logger.warning(f"Not a Kobo submission UUID, audit log skipped: {uuid!r}")
        return None

    audit_dir = get_audit_dir()
    file_path = os.path.join(audit_dir, f"{uuid}.csv")

    logger.info(f"Downloading audit log for {uuid} from: {audit_url}")

    # Skip if file already exists
    if os.path.exists(file_path):
        logger.debug(f"Audit log already exists for {uuid}, skipping download")
        return file_path

    if not fetcher.download_audit_log(audit_url, file_path):
        return None
    return file_path


# A screen with one question, and a screen with a whole field-list group.
_TIMED_EVENTS = ("question", "group questions")


def _node_key(node: str) -> str:
    """
    An audit node as its answer's key: `/data/hh/income` is `hh/income`. The
    first segment of an absolute node is the form's root, whatever it is named.
    """
    node = node.strip()
    parts = [p for p in node.split("/") if p]
    return "/".join(parts[1:] if node.startswith("/") else parts)


def process_audit_log(file_path: str, uuid: str) -> dict[str, Any] | None:
    """
    Process a single audit log CSV file and calculate metrics.

    Based on the R implementation in hfc/R/utils.R:process_single_audit

    Args:
        file_path: Path to the audit log CSV file
        uuid: Submission UUID

    Returns:
        Dictionary with metrics: {
            'active_interview_time': float (minutes),
            'total_duration': float (minutes),
            'jump_count': int,
            'median_question_time': float (seconds),
            'question_seconds': {answer key: seconds on it, coming back included}
        }
        A field-list group's screen is timed as one, under the group's key.
        Returns None if processing fails
    """
    if not os.path.exists(file_path):
        return None

    try:
        # Read CSV file
        question_events = []
        all_events = []
        question_seconds: dict[str, float] = {}

        with open(file_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    # Parse start and end times (milliseconds)
                    start = float(row.get("start", 0))
                    end = float(row.get("end", 0))
                    event = row.get("event", "")

                    all_events.append({"start": start, "end": end, "event": event})

                    # Filter for question events
                    if event == "question":
                        question_events.append({"start": start, "end": end})
                    if (
                        event in _TIMED_EVENTS
                        and end > start
                        and (key := _node_key(row.get("node") or ""))
                    ):
                        question_seconds[key] = question_seconds.get(key, 0) + (end - start) / 1000

                except (ValueError, KeyError) as e:
                    logger.debug(f"Skipping invalid row in audit log {file_path}: {e}")
                    continue

        if not all_events:
            logger.debug(f"No events found in audit log {file_path}")
            return None

        # Calculate Active Interview Time (sum of 'question' event durations)
        active_time_ms = 0
        question_durations = []

        for q_event in question_events:
            duration_ms = q_event["end"] - q_event["start"]
            if duration_ms > 0:
                active_time_ms += duration_ms
                question_durations.append(duration_ms / 1000)  # Convert to seconds

        active_interview_time = round(active_time_ms / (1000 * 60))  # Convert to minutes

        # Calculate Total Duration: max(end) - min(start) across all events
        # This is more robust than looking for specific "form start/finalize" events
        start_times = [e["start"] for e in all_events if e["start"] > 0]
        end_times = [e["end"] for e in all_events if e["end"] > 0]

        if start_times and end_times:
            form_start_time = min(start_times)
            form_end_time = max(end_times)  # Use max(end) for total duration
            total_duration = (form_end_time - form_start_time) / (1000 * 60)  # Convert to minutes
        else:
            total_duration = None

        # Jump Count
        jump_count = sum(1 for e in all_events if e["event"] == "jump")

        # Median Time Per Question (in seconds)
        if question_durations:
            question_durations_sorted = sorted(question_durations)
            n = len(question_durations_sorted)
            if n % 2 == 0:
                median_question_time = (
                    question_durations_sorted[n // 2 - 1] + question_durations_sorted[n // 2]
                ) / 2
            else:
                median_question_time = question_durations_sorted[n // 2]
            median_question_time = round(median_question_time)
        else:
            median_question_time = None

        return {
            "active_interview_time": active_interview_time,
            "total_duration": total_duration,
            "jump_count": jump_count,
            "median_question_time": median_question_time,
            "question_seconds": {key: round(sec, 1) for key, sec in question_seconds.items()},
        }

    except Exception as e:
        logger.warning(f"Error processing audit log {file_path}: {e}", exc_info=True)
        return None


def download_and_process_audit(
    audit_url: str | None, uuid: str, fetcher: "KoboFetcher"
) -> dict[str, Any] | None:
    """
    Download and process a single audit log.

    Args:
        audit_url: URL to the audit log CSV (from Kobo submission)
        uuid: Submission UUID
        fetcher: The pull's Kobo fetcher

    Returns:
        Dictionary with metrics, or None if unavailable
    """
    if not audit_url:
        return None

    # Download audit log
    file_path = download_audit_log(audit_url, uuid, fetcher)
    if not file_path:
        return None

    # Process audit log
    return process_audit_log(file_path, uuid)

"""
Tests for audit log processor.
"""

import csv
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
import requests

from etl.audit_processor import download_audit_log, get_audit_dir, process_audit_log
from etl.kobo_fetcher import KoboFetcher

KOBO = "https://kf.kobotoolbox.org/api/v2"


class TestDownloads:
    """
    An audit log's URL and file name come from the submission, so from
    whichever server answered the pull.
    """

    @pytest.fixture
    def audit_dir(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AUDIT_DIR", str(tmp_path / "audits"))
        return tmp_path / "audits"

    def test_a_uuid_that_is_a_path_writes_nothing(self, audit_dir, tmp_path):
        fetcher = MagicMock()
        assert download_audit_log(f"{KOBO}/audit.csv", "../../escape", fetcher) is None
        fetcher.download_audit_log.assert_not_called()
        assert not (tmp_path / "escape.csv").exists()

    def test_the_key_goes_to_the_kobo_server_only(self, audit_dir):
        fetcher = KoboFetcher(api_token="tok", api_url=KOBO)
        with patch.object(fetcher.session, "get") as get:
            path = download_audit_log("https://collector.example/audit.csv", "u-1", fetcher)
        assert path is None
        get.assert_not_called()

    def test_a_download_cut_short_leaves_no_file(self, audit_dir):
        fetcher = KoboFetcher(api_token="tok", api_url=KOBO)
        response = MagicMock()
        response.iter_content.side_effect = requests.ConnectionError("dropped")
        with patch.object(fetcher.session, "get", return_value=response):
            assert download_audit_log(f"{KOBO}/audit.csv", "u-1", fetcher) is None
        # Nothing for a later pull to take for the audit log.
        assert list(audit_dir.iterdir()) == []

    def test_a_kobo_audit_log_is_downloaded_once(self, audit_dir):
        fetcher = KoboFetcher(api_token="tok", api_url=KOBO)
        response = MagicMock()
        response.iter_content.return_value = [b"event,start,end,node\n"]
        with patch.object(fetcher.session, "get", return_value=response) as get:
            first = download_audit_log(f"{KOBO}/audit.csv", "u-1", fetcher)
            second = download_audit_log(f"{KOBO}/audit.csv", "u-1", fetcher)
        assert first == second == str(audit_dir / "u-1.csv")
        assert get.call_count == 1


class TestAuditProcessor:
    """Tests for audit log processing."""

    def test_process_audit_log_with_question_events(self):
        """Test processing audit log with question events."""
        # Create a temporary audit log CSV
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=["event", "start", "end", "node"])
            writer.writeheader()
            # Add question events (times in milliseconds)
            writer.writerow({"event": "form start", "start": "1000", "end": "1000", "node": ""})
            writer.writerow(
                {"event": "question", "start": "2000", "end": "62000", "node": "q1"}
            )  # 60 seconds = 1 minute
            writer.writerow(
                {"event": "question", "start": "63000", "end": "123000", "node": "q2"}
            )  # 60 seconds = 1 minute
            writer.writerow(
                {"event": "question", "start": "124000", "end": "184000", "node": "q3"}
            )  # 60 seconds = 1 minute
            writer.writerow(
                {"event": "form finalize", "start": "185000", "end": "185000", "node": ""}
            )
            temp_file = f.name

        try:
            uuid = "test-uuid-123"
            metrics = process_audit_log(temp_file, uuid)

            assert metrics is not None
            # Total active time: 60 + 60 + 60 = 180 seconds = 3 minutes
            assert metrics["active_interview_time"] == 3
            assert metrics["jump_count"] == 0
            assert metrics["total_duration"] is not None
        finally:
            os.unlink(temp_file)

    def test_process_audit_log_with_jumps(self):
        """Test processing audit log with jump events."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=["event", "start", "end", "node"])
            writer.writeheader()
            writer.writerow({"event": "question", "start": "1000", "end": "5000", "node": "q1"})
            writer.writerow({"event": "jump", "start": "6000", "end": "6000", "node": ""})
            writer.writerow({"event": "question", "start": "7000", "end": "10000", "node": "q2"})
            temp_file = f.name

        try:
            metrics = process_audit_log(temp_file, "test-uuid")

            assert metrics is not None
            assert metrics["jump_count"] == 1
        finally:
            os.unlink(temp_file)

    def test_process_audit_log_calculates_median_question_time(self):
        """Test that median question time is calculated correctly."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=["event", "start", "end", "node"])
            writer.writeheader()
            # Question durations: 1s, 2s, 3s, 4s, 5s (median = 3s)
            writer.writerow(
                {"event": "question", "start": "1000", "end": "2000", "node": "q1"}
            )  # 1s
            writer.writerow(
                {"event": "question", "start": "3000", "end": "5000", "node": "q2"}
            )  # 2s
            writer.writerow(
                {"event": "question", "start": "6000", "end": "9000", "node": "q3"}
            )  # 3s
            writer.writerow(
                {"event": "question", "start": "10000", "end": "14000", "node": "q4"}
            )  # 4s
            writer.writerow(
                {"event": "question", "start": "15000", "end": "20000", "node": "q5"}
            )  # 5s
            temp_file = f.name

        try:
            metrics = process_audit_log(temp_file, "test-uuid")

            assert metrics is not None
            assert metrics["median_question_time"] == 3  # Median of [1,2,3,4,5] = 3
        finally:
            os.unlink(temp_file)

    def test_process_audit_log_handles_missing_file(self):
        """Test that processing handles missing file gracefully."""
        metrics = process_audit_log("/nonexistent/file.csv", "test-uuid")
        assert metrics is None

    def test_process_audit_log_handles_empty_file(self):
        """Test that processing handles empty file gracefully."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=["event", "start", "end"])
            writer.writeheader()
            temp_file = f.name

        try:
            metrics = process_audit_log(temp_file, "test-uuid")
            assert metrics is None
        finally:
            os.unlink(temp_file)

    def test_get_audit_dir_creates_directory(self):
        """Test that get_audit_dir creates the directory if it doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Set environment variable to use temp directory
            original_dir = os.getenv("AUDIT_DIR")
            try:
                test_audit_dir = os.path.join(temp_dir, "test_audits")
                os.environ["AUDIT_DIR"] = test_audit_dir

                # Should create directory
                audit_dir = get_audit_dir()

                assert os.path.exists(audit_dir)
                assert audit_dir == test_audit_dir
            finally:
                if original_dir:
                    os.environ["AUDIT_DIR"] = original_dir
                elif "AUDIT_DIR" in os.environ:
                    del os.environ["AUDIT_DIR"]

    def test_seconds_on_each_question_and_screen(self):
        """By answer key, coming back added; a field-list screen under its group."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=["event", "start", "end", "node"])
            writer.writeheader()
            writer.writerow({"event": "form start", "start": "1000", "end": "", "node": ""})
            for event, start, end, node in (
                ("question", 2000, 14000, "/data/hh/income"),
                ("question", 15000, 18500, "/data/consent"),
                ("group questions", 19000, 67000, "/data/fcs"),
                ("question", 70000, 76000, "/data/hh/income"),
                ("jump", 77000, 77000, ""),
            ):
                writer.writerow({"event": event, "start": start, "end": end, "node": node})
            temp_file = f.name
        try:
            metrics = process_audit_log(temp_file, "test-uuid")
            assert metrics is not None
            assert metrics["question_seconds"] == {"hh/income": 18.0, "consent": 3.5, "fcs": 48.0}
        finally:
            os.unlink(temp_file)

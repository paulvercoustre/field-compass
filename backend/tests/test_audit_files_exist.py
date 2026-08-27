"""
Test to verify audit files exist and can be processed.
"""

import os

import pytest

from etl.audit_processor import get_audit_dir, process_audit_log


def test_audit_directory_exists():
    """Test that the audit directory exists."""
    audit_dir = get_audit_dir()
    assert os.path.exists(audit_dir), f"Audit directory does not exist: {audit_dir}"


def test_list_audit_files():
    """Test that we can list audit files."""
    audit_dir = get_audit_dir()

    if not os.path.exists(audit_dir):
        pytest.skip("Audit directory does not exist")

    csv_files = [f for f in os.listdir(audit_dir) if f.endswith(".csv")]

    print(f"\nFound {len(csv_files)} audit file(s) in {audit_dir}")

    # This test just verifies we can list files, doesn't require any to exist
    assert isinstance(csv_files, list)


def test_audit_files_can_be_processed():
    """Test that existing audit files can be processed."""
    audit_dir = get_audit_dir()

    if not os.path.exists(audit_dir):
        pytest.skip("Audit directory does not exist")

    csv_files = [f for f in os.listdir(audit_dir) if f.endswith(".csv")]

    if not csv_files:
        pytest.skip("No audit files found to test")

    # Process the first file
    filename = csv_files[0]
    uuid = filename.replace(".csv", "")
    file_path = os.path.join(audit_dir, filename)

    metrics = process_audit_log(file_path, uuid)

    assert metrics is not None, f"Failed to process audit file: {filename}"
    assert "active_interview_time" in metrics, "Missing active_interview_time in metrics"
    assert isinstance(
        metrics["active_interview_time"], int | float
    ), "active_interview_time should be numeric"


@pytest.mark.parametrize(
    "uuid",
    [
        "test-uuid-1",
        "test-uuid-2",
    ],
)
def test_specific_uuid_has_audit_file(uuid):
    """Test if a specific UUID has an audit file (may not exist)."""
    audit_dir = get_audit_dir()
    file_path = os.path.join(audit_dir, f"{uuid}.csv")

    if os.path.exists(file_path):
        metrics = process_audit_log(file_path, uuid)
        assert metrics is not None, f"Audit file exists but failed to process: {uuid}"
    else:
        pytest.skip(f"Audit file does not exist for UUID: {uuid}")

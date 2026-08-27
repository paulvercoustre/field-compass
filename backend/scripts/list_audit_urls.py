#!/usr/bin/env python3
"""
List Audit URLs
Shows audit URLs from submissions in the database.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import SubmissionCurrent


def list_audit_urls_from_submissions():
    """List audit URLs from submissions in the database."""
    # Get database URL from environment
    database_url = os.getenv(
        "DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/field_compass"
    )

    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # Get all submissions
        submissions = db.query(SubmissionCurrent).all()

        print(f"Total submissions in database: {len(submissions)}")
        print()

        submissions_with_audit = 0
        submissions_without_audit = 0

        for submission in submissions:
            # Check if submission_data contains active_interview_time (indicates audit was processed)
            has_active_time = submission.submission_data.get("active_interview_time") is not None

            # Try to find audit URL in submission data (it might be stored there)
            # Note: audit_url is typically in the parsed submission, not in submission_data
            # But we can check if there's any reference to audit

            print(f"Submission UUID: {submission._uuid}")
            print(f"  Submission ID: {submission._id}")
            print(f"  Has active_interview_time: {'✅ Yes' if has_active_time else '❌ No'}")

            # Check submission_data for any audit-related fields
            audit_related = {
                k: v for k, v in submission.submission_data.items() if "audit" in k.lower()
            }
            if audit_related:
                print(f"  Audit-related fields in submission_data: {list(audit_related.keys())}")

            if has_active_time:
                submissions_with_audit += 1
                active_time = submission.submission_data.get("active_interview_time")
                print(f"  Active Interview Time: {active_time} minutes")
            else:
                submissions_without_audit += 1

            print()

        print("Summary:")
        print(f"  Submissions with processed audit logs: {submissions_with_audit}")
        print(f"  Submissions without processed audit logs: {submissions_without_audit}")
        print()
        print("Note: Audit URLs are extracted from Kobo API responses during ETL.")
        print(
            "      If submissions don't have active_interview_time, audit logs may not have been downloaded."
        )

    finally:
        db.close()


def check_submission_audit_url(uuid: str):
    """Check audit URL for a specific submission UUID."""
    database_url = os.getenv(
        "DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/field_compass"
    )

    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        submission = db.query(SubmissionCurrent).filter(SubmissionCurrent._uuid == uuid).first()

        if not submission:
            print(f"❌ Submission not found with UUID: {uuid}")
            return

        print(f"Submission UUID: {uuid}")
        print(f"Submission ID: {submission._id}")
        print()

        has_active_time = submission.submission_data.get("active_interview_time") is not None

        if has_active_time:
            active_time = submission.submission_data.get("active_interview_time")
            print("✅ Has processed audit log")
            print(f"   Active Interview Time: {active_time} minutes")
        else:
            print("❌ No processed audit log found")
            print("   (This could mean: audit URL was missing, download failed, or ETL hasn't run)")

        print()
        print(
            "Note: To see the actual audit URL, check the ETL pipeline logs when processing this submission."
        )

    finally:
        db.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="List audit URLs from submissions")
    parser.add_argument("--uuid", help="Check specific submission UUID")

    args = parser.parse_args()

    if args.uuid:
        check_submission_audit_url(args.uuid)
    else:
        list_audit_urls_from_submissions()

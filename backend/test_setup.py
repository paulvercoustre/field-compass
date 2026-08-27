"""
Simple script to test database connection and basic setup.
Run this to verify the environment is configured correctly.
"""

import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/field_compass"
)


def test_database_connection():
    """Test if we can connect to the database."""
    print("Testing database connection...")
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            print("✓ Database connection successful")
            return True
    except Exception as e:
        print(f"✗ Database connection failed: {e}")
        return False


def test_tables_exist():
    """Test if required tables exist."""
    print("\nTesting if tables exist...")
    required_tables = [
        "survey_configs",
        "validation_rules",
        "submissions_current",
        "submissions_history",
    ]

    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect() as conn:
            for table in required_tables:
                result = conn.execute(
                    text(
                        f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '{table}')"
                    )
                )
                exists = result.scalar()
                if exists:
                    print(f"✓ Table '{table}' exists")
                else:
                    print(f"✗ Table '{table}' does not exist")
                    return False
        return True
    except Exception as e:
        print(f"✗ Error checking tables: {e}")
        return False


def test_imports():
    """Test if all required modules can be imported."""
    print("\nTesting Python imports...")
    try:
        from database.models import (
            Base,
            SubmissionCurrent,
            SubmissionHistory,
            SurveyConfig,
            ValidationRule,
        )

        print("✓ Database models imported successfully")

        from models import Submission
        from models import SubmissionHistory as SubmissionHistoryPydantic

        print("✓ Pydantic models imported successfully")

        from routers import progress, submissions

        print("✓ Routers imported successfully")

        return True
    except ImportError as e:
        print(f"✗ Import failed: {e}")
        print("  Make sure all dependencies are installed: pip install -r requirements.txt")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        return False


if __name__ == "__main__":
    print("=" * 50)
    print("Field Compass Setup Test")
    print("=" * 50)

    all_passed = True

    # Test imports first (doesn't require database)
    all_passed = test_imports() and all_passed

    # Test database connection
    if test_database_connection():
        # Test tables
        all_passed = test_tables_exist() and all_passed
    else:
        print("\n⚠ Skipping table tests (database not available)")
        all_passed = False

    print("\n" + "=" * 50)
    if all_passed:
        print("✓ All tests passed! Setup looks good.")
        sys.exit(0)
    else:
        print("✗ Some tests failed. Please check the errors above.")
        sys.exit(1)

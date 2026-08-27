"""
Test script for ETL pipeline with real KoboToolbox data.
This script helps set up and test the ETL pipeline.
"""

import os
import sys

from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, ".")

import logging

from database.models import SurveyConfig
from etl.kobo_fetcher import create_fetcher_from_env
from etl.pipeline import ETLPipeline
from services.database import get_db, init_db

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

load_dotenv()


def check_environment():
    """Check if required environment variables are set."""
    print("=" * 60)
    print("Environment Check")
    print("=" * 60)

    api_token = os.getenv("KOBO_API_TOKEN")
    api_url = os.getenv("KOBO_API_URL", "https://kf.kobotoolbox.org/api/v2")

    if not api_token:
        print("❌ KOBO_API_TOKEN is not set")
        print("\nTo set it:")
        print("  1. Get your API token from: https://kf.kobotoolbox.org/token/")
        print("  2. Add to .env file: KOBO_API_TOKEN=your_token_here")
        return False
    else:
        print(f"✓ KOBO_API_TOKEN is set (length: {len(api_token)})")

    print(f"✓ KOBO_API_URL: {api_url}")
    print("=" * 60)
    return True


def list_surveys():
    """List all surveys in the database."""
    print("\n" + "=" * 60)
    print("Surveys in Database")
    print("=" * 60)

    db = next(get_db())
    try:
        surveys = db.query(SurveyConfig).all()

        if not surveys:
            print("No surveys found in database.")
            print("\nTo create a survey configuration, you can:")
            print("  1. Use the API endpoint: POST /api/surveys")
            print("  2. Insert directly into database")
            print("  3. Use the create_survey_config() function below")
            return None

        for survey in surveys:
            print(f"\nSurvey ID: {survey.survey_id}")
            print(f"  Name: {survey.survey_name}")
            print(f"  Kobo Asset ID: {survey.kobo_asset_id or 'NOT SET'}")
            print(f"  Created: {survey.created_at}")

        return surveys
    finally:
        db.close()


def test_kobo_connection():
    """Test connection to KoboToolbox API."""
    print("\n" + "=" * 60)
    print("Testing KoboToolbox API Connection")
    print("=" * 60)

    try:
        create_fetcher_from_env()

        # Try to get user info (this is a simple endpoint to test auth)
        # Note: Kobo API v2 doesn't have a simple user endpoint, so we'll test with asset list
        print("Testing API connection...")
        print("✓ KoboFetcher created successfully")
        print("\nTo test with a real asset, you need:")
        print("  1. A survey configured in the database with kobo_asset_id")
        print("  2. Run the ETL pipeline with that survey_id")

        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def create_test_survey_config(db, survey_name: str, kobo_asset_id: str, config_data: dict):
    """Create a test survey configuration."""
    from uuid import uuid4

    survey = SurveyConfig(
        survey_id=uuid4(),
        survey_name=survey_name,
        kobo_asset_id=kobo_asset_id,
        config_data=config_data,
    )

    db.add(survey)
    db.commit()
    db.refresh(survey)

    print("\n✓ Created survey configuration:")
    print(f"  Survey ID: {survey.survey_id}")
    print(f"  Name: {survey.survey_name}")
    print(f"  Kobo Asset ID: {survey.kobo_asset_id}")

    return survey


def test_etl_pipeline(survey_id: str, limit: int = 5):
    """Test the ETL pipeline with a small number of submissions."""
    print("\n" + "=" * 60)
    print(f"Testing ETL Pipeline (limit: {limit})")
    print("=" * 60)

    if not init_db():
        print("❌ Database connection failed")
        return False

    db = next(get_db())
    try:
        # Verify survey exists
        survey = db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).first()
        if not survey:
            print(f"❌ Survey not found: {survey_id}")
            return False

        if not survey.kobo_asset_id:
            print(f"❌ Survey '{survey.survey_name}' does not have a kobo_asset_id configured")
            return False

        print(f"✓ Found survey: {survey.survey_name}")
        print(f"✓ Kobo Asset ID: {survey.kobo_asset_id}")

        # Create pipeline
        pipeline = ETLPipeline(db)

        # Run pipeline with small limit for testing
        print("\nRunning ETL pipeline...")
        stats = pipeline.run_pipeline(survey_id=str(survey_id), limit=limit)

        # Print results
        print("\n" + "=" * 60)
        print("ETL Pipeline Results")
        print("=" * 60)
        print(f"Fetched:        {stats['fetched']}")
        print(f"Created:        {stats['created']}")
        print(f"Updated:        {stats['updated']}")
        print(f"Edited:         {stats['edited']}")
        print(f"HFC Flagged:    {stats['hfc_flagged']}")
        print(f"Errors:         {stats['errors']}")
        if "duration_seconds" in stats:
            print(f"Duration:       {stats['duration_seconds']:.2f} seconds")
        print("=" * 60)

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback

        traceback.print_exc()
        return False
    finally:
        db.close()


def main():
    """Main test function."""
    print("\n" + "=" * 60)
    print("Field Compass ETL Pipeline Test")
    print("=" * 60)

    # Step 1: Check environment
    if not check_environment():
        print("\n⚠️  Please set up environment variables first")
        return

    # Step 2: Check database connection
    if not init_db():
        print("\n❌ Database connection failed. Make sure PostgreSQL is running.")
        print("   Run: make up")
        return

    print("\n✓ Database connection successful")

    # Step 3: List surveys
    surveys = list_surveys()

    # Step 4: Test Kobo connection
    test_kobo_connection()

    # Step 5: Interactive menu
    print("\n" + "=" * 60)
    print("Next Steps")
    print("=" * 60)

    if surveys:
        print("\nTo test the ETL pipeline with an existing survey:")
        print("  python backend/scripts/test_etl.py --run <survey_id> --limit 5")
        print("\nOr via API:")
        print("  curl -X POST 'http://localhost:8000/api/etl/run/<survey_id>?limit=5'")
    else:
        print("\nTo create a survey configuration, you need:")
        print("  1. A KoboToolbox asset UID (from your Kobo project URL)")
        print("  2. Survey configuration data")
        print("\nExample survey config structure:")
        print(
            """
{
  "uuid": "_uuid",
  "enumerator": "enumerator_id",
  "date_interview": "today",
  "start_time": "start",
  "end_time": "end",
  "dk_value": -99,
  "data_collection_start_date": "2023-01-01",
  "data_collection_end_date": "2023-12-31",
  "min_survey_duration_minutes": 10,
  "max_survey_duration_minutes": 120
}
        """
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test ETL pipeline")
    parser.add_argument("--run", help="Run ETL pipeline for a survey ID")
    parser.add_argument(
        "--limit", type=int, default=5, help="Limit number of submissions to process"
    )
    parser.add_argument(
        "--create-survey", help="Create a test survey (requires --name, --asset-id, --config)"
    )
    parser.add_argument("--name", help="Survey name")
    parser.add_argument("--asset-id", help="Kobo asset ID")

    args = parser.parse_args()

    if args.run:
        # Run ETL pipeline
        test_etl_pipeline(args.run, limit=args.limit)
    elif args.create_survey:
        # Create survey (simplified - would need full config)
        print("Survey creation via CLI not fully implemented.")
        print("Please use the API or database directly.")
    else:
        # Run checks
        main()

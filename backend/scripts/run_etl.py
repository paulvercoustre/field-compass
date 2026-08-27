"""
CLI script to run the ETL pipeline.
Usage: python scripts/run_etl.py <survey_id> [--limit N] [--start-date YYYY-MM-DD]
"""

import argparse
import sys
from datetime import datetime

from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, ".")

import logging

from etl.pipeline import ETLPipeline
from services.database import get_db, init_db

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

load_dotenv()


def main():
    parser = argparse.ArgumentParser(description="Run ETL pipeline for a survey")
    parser.add_argument("survey_id", help="Survey UUID")
    parser.add_argument("--limit", type=int, help="Maximum number of submissions to process")
    parser.add_argument(
        "--start-date", help="Only process submissions after this date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Dry run (fetch only, no processing)"
    )

    args = parser.parse_args()

    # Check database connection
    if not init_db():
        print("ERROR: Database connection failed. Make sure PostgreSQL is running.")
        sys.exit(1)

    # Parse start date if provided
    start_date = None
    if args.start_date:
        try:
            start_date = datetime.strptime(args.start_date, "%Y-%m-%d")
        except ValueError:
            print(f"ERROR: Invalid date format: {args.start_date}. Use YYYY-MM-DD")
            sys.exit(1)

    # Get database session
    db = next(get_db())

    try:
        # Create pipeline
        pipeline = ETLPipeline(db)

        if args.dry_run:
            print("DRY RUN: Would fetch submissions (no processing)")
            # TODO: Implement dry run mode
            return

        # Run pipeline
        print(f"Starting ETL pipeline for survey: {args.survey_id}")
        stats = pipeline.run_pipeline(
            survey_id=args.survey_id, limit=args.limit, start_date=start_date
        )

        # Print results
        print("\n" + "=" * 50)
        print("ETL Pipeline Results")
        print("=" * 50)
        print(f"Fetched:        {stats['fetched']}")
        print(f"Created:        {stats['created']}")
        print(f"Updated:        {stats['updated']}")
        print(f"Edited:         {stats['edited']}")
        print(f"HFC Flagged:    {stats['hfc_flagged']}")
        print(f"Errors:         {stats['errors']}")
        print(f"Duration:       {stats.get('duration_seconds', 0):.2f} seconds")
        print("=" * 50)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

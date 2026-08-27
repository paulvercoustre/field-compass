#!/usr/bin/env python3
"""
Find Survey by Kobo Asset ID
Finds the survey_id for a given kobo_asset_id.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.models import SurveyConfig
from services.database import get_db, init_db

load_dotenv()


def find_survey_by_asset_id(kobo_asset_id: str):
    """Find survey by Kobo asset ID."""
    if not init_db():
        print("ERROR: Database connection failed")
        sys.exit(1)

    db = next(get_db())
    try:
        survey = db.query(SurveyConfig).filter(SurveyConfig.kobo_asset_id == kobo_asset_id).first()

        if not survey:
            print(f"❌ No survey found with kobo_asset_id: {kobo_asset_id}")
            print()
            print("Available surveys:")
            all_surveys = db.query(SurveyConfig).all()
            for s in all_surveys:
                print(
                    f"  - {s.survey_name} (ID: {s.survey_id}, Asset: {s.kobo_asset_id or 'None'})"
                )
            sys.exit(1)

        print("✅ Found survey:")
        print(f"  Survey ID: {survey.survey_id}")
        print(f"  Name: {survey.survey_name}")
        print(f"  Kobo Asset ID: {survey.kobo_asset_id}")
        print()
        print("To run ETL for this survey, use:")
        print(f"  python scripts/run_etl.py {survey.survey_id}")
        print()
        print("Or via API:")
        print(f"  POST /api/etl/run/{survey.survey_id}")

        return str(survey.survey_id)

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/find_survey_by_asset.py <kobo_asset_id>")
        sys.exit(1)

    find_survey_by_asset_id(sys.argv[1])

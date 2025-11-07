"""
Helper script to create a survey configuration in the database.
Usage: python scripts/create_survey_config.py --name "Survey Name" --asset-id "abc123" [--config-file config.json]
"""

import sys
import json
import argparse
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, '.')

from services.database import get_db, init_db
from database.models import SurveyConfig
from uuid import uuid4

load_dotenv()


def create_survey_config(
    survey_name: str,
    kobo_asset_id: str,
    config_data: dict
) -> str:
    """
    Create a survey configuration.
    
    Returns:
        Survey ID (UUID as string)
    """
    if not init_db():
        print("ERROR: Database connection failed")
        sys.exit(1)
    
    db = next(get_db())
    try:
        # Check if survey name already exists
        existing = db.query(SurveyConfig).filter(
            SurveyConfig.survey_name == survey_name
        ).first()
        
        if existing:
            print(f"Survey '{survey_name}' already exists with ID: {existing.survey_id}")
            return str(existing.survey_id)
        
        # Create new survey
        survey = SurveyConfig(
            survey_id=uuid4(),
            survey_name=survey_name,
            kobo_asset_id=kobo_asset_id,
            config_data=config_data
        )
        
        db.add(survey)
        db.commit()
        db.refresh(survey)
        
        print(f"✓ Created survey configuration:")
        print(f"  Survey ID: {survey.survey_id}")
        print(f"  Name: {survey.survey_name}")
        print(f"  Kobo Asset ID: {survey.kobo_asset_id}")
        
        return str(survey.survey_id)
        
    except Exception as e:
        print(f"ERROR: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


def get_default_config() -> dict:
    """Get default survey configuration."""
    return {
        "uuid": "_uuid",
        "enumerator": "enumerator_id",
        "date_interview": "today",
        "start_time": "start",
        "end_time": "end",
        "dk_value": -99,
        "dk_string_value": "dk",
        "data_collection_start_date": "2023-01-01",
        "data_collection_end_date": "2023-12-31",
        "min_survey_duration_minutes": 10,
        "max_survey_duration_minutes": 120,
        "sampling_cols": []
    }


def main():
    parser = argparse.ArgumentParser(description='Create a survey configuration')
    parser.add_argument('--name', required=True, help='Survey name')
    parser.add_argument('--asset-id', required=True, help='KoboToolbox asset ID')
    parser.add_argument('--config-file', help='Path to JSON config file')
    parser.add_argument('--use-defaults', action='store_true', help='Use default configuration')
    
    args = parser.parse_args()
    
    # Load config
    if args.config_file:
        with open(args.config_file, 'r') as f:
            config_data = json.load(f)
    elif args.use_defaults:
        config_data = get_default_config()
        print("Using default configuration. You may want to customize it later.")
    else:
        print("ERROR: Either --config-file or --use-defaults must be provided")
        print("\nExample config structure:")
        print(json.dumps(get_default_config(), indent=2))
        sys.exit(1)
    
    # Create survey
    survey_id = create_survey_config(
        survey_name=args.name,
        kobo_asset_id=args.asset_id,
        config_data=config_data
    )
    
    print(f"\n✓ Survey created successfully!")
    print(f"\nTo test the ETL pipeline:")
    print(f"  python backend/scripts/test_etl.py --run {survey_id} --limit 5")
    print(f"\nOr via API:")
    print(f"  curl -X POST 'http://localhost:8000/api/etl/run/{survey_id}?limit=5'")


if __name__ == '__main__':
    main()

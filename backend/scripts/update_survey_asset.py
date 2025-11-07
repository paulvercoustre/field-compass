"""
Update a survey's Kobo Asset ID.
Usage: python scripts/update_survey_asset.py <survey_id> <kobo_asset_id>
"""

import sys
from uuid import UUID
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, '.')

from services.database import get_db, init_db
from database.models import SurveyConfig

load_dotenv()


def update_survey_asset(survey_id: str, kobo_asset_id: str):
    """Update a survey's Kobo Asset ID."""
    if not init_db():
        print("ERROR: Database connection failed")
        sys.exit(1)
    
    try:
        survey_uuid = UUID(survey_id)
    except ValueError:
        print(f"ERROR: Invalid survey_id format: {survey_id}. Must be a valid UUID.")
        sys.exit(1)
    
    db = next(get_db())
    try:
        survey = db.query(SurveyConfig).filter(
            SurveyConfig.survey_id == survey_uuid
        ).first()
        
        if not survey:
            print(f"ERROR: Survey not found: {survey_id}")
            sys.exit(1)
        
        old_asset_id = survey.kobo_asset_id
        survey.kobo_asset_id = kobo_asset_id
        
        db.commit()
        db.refresh(survey)
        
        print(f"✓ Updated survey:")
        print(f"  Survey ID: {survey.survey_id}")
        print(f"  Name: {survey.survey_name}")
        print(f"  Old Asset ID: {old_asset_id}")
        print(f"  New Asset ID: {survey.kobo_asset_id}")
        
    except Exception as e:
        print(f"ERROR: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python scripts/update_survey_asset.py <survey_id> <kobo_asset_id>")
        sys.exit(1)
    
    survey_id = sys.argv[1]
    kobo_asset_id = sys.argv[2]
    
    update_survey_asset(survey_id, kobo_asset_id)


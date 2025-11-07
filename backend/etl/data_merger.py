"""
Data Merger
Handles upsert logic for submissions with edit detection and history tracking.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import and_
import jsonpatch
import logging

from database.models import SubmissionCurrent, SubmissionHistory
from services.database import get_db

logger = logging.getLogger(__name__)


def calculate_json_diff(old_data: Dict[str, Any], new_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Calculate JSON patch diff between old and new data.
    
    Args:
        old_data: Previous submission data
        new_data: New submission data
        
    Returns:
        List of JSON patch operations
    """
    try:
        # Create JSON patch
        patch = jsonpatch.make_patch(old_data, new_data)
        
        # Convert to list of dicts
        patches = []
        for op in patch:
            patch_dict = {
                'op': op['op'],
                'path': op['path'],
            }
            if 'value' in op:
                patch_dict['value'] = op['value']
            if 'from' in op:
                patch_dict['from'] = op['from']
            patches.append(patch_dict)
        
        return patches
    except Exception as e:
        logger.error(f"Error calculating JSON diff: {e}")
        return []


def is_edited_submission(
    existing_submission: SubmissionCurrent,
    new_end_timestamp: datetime,
    threshold_seconds: int = 300
) -> bool:
    """
    Check if a submission has been edited based on timestamp comparison.
    
    A submission is considered edited if:
    - The new 'end' timestamp is greater than the original '_submission_time' + threshold
    
    Args:
        existing_submission: Existing submission from database
        new_end_timestamp: New 'end' timestamp from Kobo
        threshold_seconds: Threshold in seconds (default: 300 = 5 minutes)
        
    Returns:
        True if submission was edited, False otherwise
    """
    time_diff = (new_end_timestamp - existing_submission._submission_time).total_seconds()
    return time_diff > threshold_seconds


def parse_kobo_submission(kobo_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse Kobo API submission data into our format.
    
    Args:
        kobo_data: Raw submission data from Kobo API
        
    Returns:
        Parsed submission data dictionary
    """
    # Extract metadata
    submission_id = kobo_data.get('_id')
    uuid = kobo_data.get('_uuid', '')
    submission_time_str = kobo_data.get('_submission_time', '')
    end_time_str = kobo_data.get('end', '')
    
    # Parse timestamps
    try:
        submission_time = datetime.fromisoformat(submission_time_str.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        logger.warning(f"Could not parse _submission_time: {submission_time_str}")
        submission_time = datetime.utcnow()
    
    try:
        end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        logger.warning(f"Could not parse end time: {end_time_str}")
        end_time = datetime.utcnow()
    
    # Extract submission data (everything except metadata fields)
    metadata_fields = ['_id', '_uuid', '_submission_time', 'end', '_attachments', '_geolocation', 
                       '_notes', '_status', '_submitted_by', '_tags', '_validation_status', 
                       '_xform_id_string', 'formhub/uuid', 'meta/instanceID', '_audit_URL']
    
    submission_data = {k: v for k, v in kobo_data.items() if k not in metadata_fields}
    
    return {
        '_id': submission_id,
        '_uuid': uuid,
        '_submission_time': submission_time,
        'end': end_time,
        'submission_data': submission_data,
        'audit_url': kobo_data.get('_audit_URL') or kobo_data.get('audit_URL')
    }


def merge_submission(
    db: Session,
    parsed_submission: Dict[str, Any],
    survey_id: str,
    threshold_seconds: int = 300
) -> Tuple[SubmissionCurrent, Optional[SubmissionHistory]]:
    """
    Merge a submission into the database (upsert with edit detection).
    
    Args:
        db: Database session
        parsed_submission: Parsed submission data from parse_kobo_submission
        survey_id: UUID of the survey configuration
        threshold_seconds: Threshold for edit detection (default: 300)
        
    Returns:
        Tuple of (SubmissionCurrent, SubmissionHistory or None)
    """
    submission_id = parsed_submission['_id']
    new_uuid = parsed_submission['_uuid']
    new_end = parsed_submission['end']
    new_data = parsed_submission['submission_data']
    
    # Check if submission exists
    existing = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == submission_id).first()
    
    history_record = None
    
    if existing:
        # Check if this is an edit
        is_edited = is_edited_submission(existing, new_end, threshold_seconds)
        
        if is_edited:
            # Calculate diff before updating
            old_data = existing.submission_data
            data_delta = calculate_json_diff(old_data, new_data)
            
            # Create history record
            history_record = SubmissionHistory(
                kobo_id=submission_id,
                timestamp=new_end,
                deprecated_uuid=existing._uuid,
                data_delta=data_delta
            )
            db.add(history_record)
            
            # Update existing submission
            existing._uuid = new_uuid
            existing.end = new_end
            existing.submission_data = new_data
            existing.is_edited = True
            existing.updated_at = datetime.utcnow()
            
            logger.info(f"Updated submission {submission_id} (edited, {len(data_delta)} changes)")
        else:
            # No significant edit, just update metadata if needed
            if existing._uuid != new_uuid:
                existing._uuid = new_uuid
            if existing.end != new_end:
                existing.end = new_end
            existing.updated_at = datetime.utcnow()
            
            logger.debug(f"Updated submission {submission_id} metadata (no significant edit)")
        
        db.commit()
        db.refresh(existing)
        return existing, history_record
    else:
        # New submission
        new_submission = SubmissionCurrent(
            _id=submission_id,
            survey_id=survey_id,
            _uuid=new_uuid,
            _submission_time=parsed_submission['_submission_time'],
            end=new_end,
            submission_data=new_data,
            is_edited=False,
            data_quality_issues=[],
            qa_status='PENDING_QA'
        )
        
        db.add(new_submission)
        db.commit()
        db.refresh(new_submission)
        
        logger.info(f"Created new submission {submission_id}")
        return new_submission, None


def merge_submissions_batch(
    db: Session,
    kobo_submissions: List[Dict[str, Any]],
    survey_id: str,
    threshold_seconds: int = 300
) -> Dict[str, int]:
    """
    Merge a batch of submissions.
    
    Args:
        db: Database session
        kobo_submissions: List of raw Kobo submission dictionaries
        survey_id: UUID of the survey configuration
        threshold_seconds: Threshold for edit detection
        
    Returns:
        Dictionary with statistics: {'created': int, 'updated': int, 'edited': int, 'errors': int}
    """
    stats = {'created': 0, 'updated': 0, 'edited': 0, 'errors': 0}
    
    for kobo_sub in kobo_submissions:
        try:
            parsed = parse_kobo_submission(kobo_sub)
            existing, history = merge_submission(db, parsed, survey_id, threshold_seconds)
            
            if existing.is_edited and history:
                stats['edited'] += 1
                stats['updated'] += 1
            elif existing.is_edited is False and history is None:
                stats['created'] += 1
            else:
                stats['updated'] += 1
                
        except Exception as e:
            logger.error(f"Error merging submission: {e}")
            stats['errors'] += 1
            db.rollback()
            continue
    
    return stats


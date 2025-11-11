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
    # Handle timezone-aware vs timezone-naive datetime comparison
    existing_time = existing_submission._submission_time
    if existing_time.tzinfo is None and new_end_timestamp.tzinfo is not None:
        # If existing is naive but new is aware, make existing aware (assume UTC)
        from datetime import timezone
        existing_time = existing_time.replace(tzinfo=timezone.utc)
    elif existing_time.tzinfo is not None and new_end_timestamp.tzinfo is None:
        # If existing is aware but new is naive, make new aware (assume UTC)
        from datetime import timezone
        new_end_timestamp = new_end_timestamp.replace(tzinfo=timezone.utc)
    
    time_diff = (new_end_timestamp - existing_time).total_seconds()
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
    # Handle timezone-aware and timezone-naive timestamps
    try:
        if 'Z' in submission_time_str or '+' in submission_time_str or submission_time_str.count('-') > 2:
            # Has timezone info
            submission_time = datetime.fromisoformat(submission_time_str.replace('Z', '+00:00'))
        else:
            # No timezone - try to infer from end_time if available
            submission_time = datetime.fromisoformat(submission_time_str)
            # If end_time has timezone, assume submission_time is in same timezone
            if end_time_str:
                try:
                    end_temp = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
                    if end_temp.tzinfo:
                        # Apply same timezone to submission_time
                        submission_time = submission_time.replace(tzinfo=end_temp.tzinfo)
                    else:
                        # Both naive, assume UTC
                        from datetime import timezone
                        submission_time = submission_time.replace(tzinfo=timezone.utc)
                except:
                    from datetime import timezone
                    submission_time = submission_time.replace(tzinfo=timezone.utc)
            else:
                # No end_time to infer from, assume UTC
                from datetime import timezone
                submission_time = submission_time.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError) as e:
        logger.warning(f"Could not parse _submission_time: {submission_time_str}, error: {e}")
        submission_time = datetime.utcnow()
    
    try:
        if end_time_str:
            end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
            # If end_time is naive but submission_time has timezone, apply same timezone
            if end_time.tzinfo is None and submission_time.tzinfo:
                end_time = end_time.replace(tzinfo=submission_time.tzinfo)
            elif end_time.tzinfo is None:
                from datetime import timezone
                end_time = end_time.replace(tzinfo=timezone.utc)
        else:
            # No end_time provided, use submission_time
            end_time = submission_time
    except (ValueError, AttributeError) as e:
        logger.warning(f"Could not parse end time: {end_time_str}, error: {e}")
        end_time = submission_time if 'submission_time' in locals() else datetime.utcnow()
    
    # Ensure both are timezone-aware and in UTC for storage
    from datetime import timezone
    if submission_time.tzinfo is None:
        submission_time = submission_time.replace(tzinfo=timezone.utc)
    else:
        submission_time = submission_time.astimezone(timezone.utc)
    
    if end_time.tzinfo is None:
        end_time = end_time.replace(tzinfo=timezone.utc)
    else:
        end_time = end_time.astimezone(timezone.utc)
    
    # Extract submission data - keep ALL fields (don't filter out metadata)
    # This ensures form fields like 'start' and 'end' are preserved in submission_data
    # Kobo's metadata fields (like '_submission_time', 'end') are already extracted separately above
    # If there are form fields with the same names, they will be in submission_data
    submission_data = {k: v for k, v in kobo_data.items()}
    
    # Extract Kobo validation status
    # _validation_status is a dict with format: {'timestamp': ..., 'uid': ..., 'by_whom': ..., 'label': 'Approved'}
    # We need to extract the 'label' field which contains the actual status
    kobo_validation_status_raw = kobo_data.get('_validation_status')
    kobo_validation_status = None
    if kobo_validation_status_raw:
        if isinstance(kobo_validation_status_raw, dict):
            # Extract the label from the validation status dict
            kobo_validation_status = kobo_validation_status_raw.get('label')
        elif isinstance(kobo_validation_status_raw, str):
            # If it's already a string, use it directly
            kobo_validation_status = kobo_validation_status_raw
    
    # Extract audit URL
    # Kobo provides _audit_URL in API response, but if not present, check _attachments
    # The audit file is often in _attachments with download_url
    audit_url = kobo_data.get('_audit_URL') or kobo_data.get('audit_URL')
    
    # If no direct audit URL, check attachments for audit.csv
    if not audit_url:
        attachments = kobo_data.get('_attachments', [])
        if attachments:
            for attachment in attachments:
                if isinstance(attachment, dict):
                    filename = attachment.get('filename', '') or attachment.get('media_file_basename', '')
                    if filename and 'audit.csv' in filename.lower():
                        audit_url = attachment.get('download_url')
                        if audit_url:
                            logger.debug(f"Found audit URL in attachments: {audit_url}")
                            break
    
    return {
        '_id': submission_id,
        '_uuid': uuid,
        '_submission_time': submission_time,
        'end': end_time,
        'submission_data': submission_data,
        'audit_url': audit_url,
        'kobo_validation_status': kobo_validation_status
    }


def merge_submission(
    db: Session,
    parsed_submission: Dict[str, Any],
    survey_id: str,
    threshold_seconds: int = 300,
    kobo_asset_id: Optional[str] = None
) -> Tuple[SubmissionCurrent, Optional[SubmissionHistory], bool]:
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
    new_submission_time = parsed_submission['_submission_time']
    new_end = parsed_submission['end']
    new_data = parsed_submission['submission_data']
    kobo_validation_status = parsed_submission.get('kobo_validation_status')
    
    # Construct Kobo edit URL
    kobo_edit_url = None
    if kobo_asset_id:
        kobo_edit_url = f"https://kf.kobotoolbox.org/#/forms/{kobo_asset_id}/data/table"
    
    # Check if submission exists (by _id only, since _id is unique across all surveys)
    existing = db.query(SubmissionCurrent).filter(SubmissionCurrent._id == submission_id).first()
    
    history_record = None
    
    if existing:
        # If submission exists but belongs to a different survey, update the survey_id
        # This handles cases where a submission is moved between surveys
        if str(existing.survey_id) != survey_id:
            logger.info(f"Submission {submission_id} exists but belongs to different survey. Updating survey_id from {existing.survey_id} to {survey_id}")
            existing.survey_id = survey_id
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
            existing._submission_time = new_submission_time
            existing.end = new_end
            existing.submission_data = new_data
            existing.is_edited = True
            existing.kobo_validation_status = kobo_validation_status
            existing.kobo_edit_url = kobo_edit_url
            existing.updated_at = datetime.utcnow()
            
            logger.info(f"Updated submission {submission_id} (edited, {len(data_delta)} changes)")
        else:
            # No significant edit, just update metadata if needed
            if existing._uuid != new_uuid:
                existing._uuid = new_uuid
            if existing._submission_time != new_submission_time:
                existing._submission_time = new_submission_time
            if existing.end != new_end:
                existing.end = new_end
            existing.kobo_validation_status = kobo_validation_status
            existing.kobo_edit_url = kobo_edit_url
            existing.updated_at = datetime.utcnow()
            
            logger.debug(f"Updated submission {submission_id} metadata (no significant edit)")
        
        db.commit()
        db.refresh(existing)
        return existing, history_record, False  # False = not newly created
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
            qa_status='PENDING_APPROVAL',  # Will be updated by HFC engine
            kobo_validation_status=kobo_validation_status,
            kobo_edit_url=kobo_edit_url
        )
        
        db.add(new_submission)
        db.commit()
        db.refresh(new_submission)
        
        logger.info(f"Created new submission {submission_id}")
        return new_submission, None, True  # True = newly created


def merge_submissions_batch(
    db: Session,
    kobo_submissions: List[Dict[str, Any]],
    survey_id: str,
    threshold_seconds: int = 300,
    kobo_asset_id: Optional[str] = None
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
            existing, history, is_new = merge_submission(db, parsed, survey_id, threshold_seconds, kobo_asset_id)
            
            if is_new:
                stats['created'] += 1
            elif history:
                stats['edited'] += 1
                stats['updated'] += 1
            else:
                stats['updated'] += 1
                
        except Exception as e:
            logger.error(f"Error merging submission: {e}")
            stats['errors'] += 1
            db.rollback()
            continue
    
    return stats


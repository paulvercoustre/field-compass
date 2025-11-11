"""
Audit Log Processor
Downloads and processes KoboToolbox audit logs to calculate active interview time.
"""

import os
import csv
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path
import requests

logger = logging.getLogger(__name__)

# Default audit directory (relative to backend directory)
DEFAULT_AUDIT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'audits')


def get_audit_dir() -> str:
    """
    Get the audit directory path.
    
    Returns:
        Path to audit directory
    """
    audit_dir = os.getenv('AUDIT_DIR', DEFAULT_AUDIT_DIR)
    # Create directory if it doesn't exist
    os.makedirs(audit_dir, exist_ok=True)
    return audit_dir


def download_audit_log(audit_url: str, uuid: str, kobo_token: Optional[str] = None) -> Optional[str]:
    """
    Download a single audit log CSV file from Kobo.
    
    Args:
        audit_url: URL to the audit log CSV
        uuid: Submission UUID (used as filename)
        kobo_token: Optional Kobo API token for authentication
        
    Returns:
        Path to downloaded file, or None if download failed
    """
    if not audit_url:
        logger.debug(f"No audit URL provided for {uuid}")
        return None
    
    audit_dir = get_audit_dir()
    file_path = os.path.join(audit_dir, f"{uuid}.csv")
    
    logger.info(f"Downloading audit log for {uuid} from: {audit_url}")
    
    # Skip if file already exists
    if os.path.exists(file_path):
        logger.debug(f"Audit log already exists for {uuid}, skipping download")
        return file_path
    
    try:
        headers = {}
        if kobo_token:
            headers['Authorization'] = f'Token {kobo_token}'
        
        response = requests.get(audit_url, headers=headers, timeout=30, stream=True)
        response.raise_for_status()
        
        # Write to file
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        logger.debug(f"Downloaded audit log for {uuid} to {file_path}")
        return file_path
        
    except Exception as e:
        logger.warning(f"Failed to download audit log for {uuid}: {e}")
        return None


def process_audit_log(file_path: str, uuid: str) -> Optional[Dict[str, Any]]:
    """
    Process a single audit log CSV file and calculate metrics.
    
    Based on the R implementation in hfc/R/utils.R:process_single_audit
    
    Args:
        file_path: Path to the audit log CSV file
        uuid: Submission UUID
        
    Returns:
        Dictionary with metrics: {
            'active_interview_time': float (minutes),
            'total_duration': float (minutes),
            'jump_count': int,
            'median_question_time': float (seconds)
        }
        Returns None if processing fails
    """
    if not os.path.exists(file_path):
        return None
    
    try:
        # Read CSV file
        question_events = []
        all_events = []
        
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    # Parse start and end times (milliseconds)
                    start = float(row.get('start', 0))
                    end = float(row.get('end', 0))
                    event = row.get('event', '')
                    
                    all_events.append({'start': start, 'end': end, 'event': event})
                    
                    # Filter for question events
                    if event == 'question':
                        question_events.append({'start': start, 'end': end})
                        
                except (ValueError, KeyError) as e:
                    logger.debug(f"Skipping invalid row in audit log {file_path}: {e}")
                    continue
        
        if not all_events:
            logger.debug(f"No events found in audit log {file_path}")
            return None
        
        # Calculate Active Interview Time (sum of 'question' event durations)
        active_time_ms = 0
        question_durations = []
        
        for q_event in question_events:
            duration_ms = q_event['end'] - q_event['start']
            if duration_ms > 0:
                active_time_ms += duration_ms
                question_durations.append(duration_ms / 1000)  # Convert to seconds
        
        active_interview_time = round(active_time_ms / (1000 * 60))  # Convert to minutes
        
        # Calculate Total Duration: max(end) - min(start) across all events
        # This is more robust than looking for specific "form start/finalize" events
        start_times = [e['start'] for e in all_events if e['start'] > 0]
        end_times = [e['end'] for e in all_events if e['end'] > 0]
        
        if start_times and end_times:
            form_start_time = min(start_times)
            form_end_time = max(end_times)  # Use max(end) for total duration
            total_duration = (form_end_time - form_start_time) / (1000 * 60)  # Convert to minutes
        else:
            total_duration = None
        
        # Jump Count
        jump_count = sum(1 for e in all_events if e['event'] == 'jump')
        
        # Median Time Per Question (in seconds)
        if question_durations:
            question_durations_sorted = sorted(question_durations)
            n = len(question_durations_sorted)
            if n % 2 == 0:
                median_question_time = (question_durations_sorted[n//2 - 1] + question_durations_sorted[n//2]) / 2
            else:
                median_question_time = question_durations_sorted[n//2]
            median_question_time = round(median_question_time)
        else:
            median_question_time = None
        
        return {
            'active_interview_time': active_interview_time,
            'total_duration': total_duration,
            'jump_count': jump_count,
            'median_question_time': median_question_time
        }
        
    except Exception as e:
        logger.warning(f"Error processing audit log {file_path}: {e}", exc_info=True)
        return None


def download_and_process_audit(
    audit_url: Optional[str],
    uuid: str,
    kobo_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Download and process a single audit log.
    
    Args:
        audit_url: URL to the audit log CSV (from Kobo submission)
        uuid: Submission UUID
        kobo_token: Optional Kobo API token
        
    Returns:
        Dictionary with metrics, or None if unavailable
    """
    if not audit_url:
        return None
    
    # Download audit log
    file_path = download_audit_log(audit_url, uuid, kobo_token)
    if not file_path:
        return None
    
    # Process audit log
    return process_audit_log(file_path, uuid)


def process_all_audits(audit_dir: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    """
    Process all audit log CSV files in a directory.
    
    Args:
        audit_dir: Directory containing audit CSV files (defaults to get_audit_dir())
        
    Returns:
        Dictionary mapping UUID to metrics: {uuid: {active_interview_time, total_duration, ...}}
    """
    if audit_dir is None:
        audit_dir = get_audit_dir()
    
    if not os.path.exists(audit_dir):
        logger.debug(f"Audit directory does not exist: {audit_dir}")
        return {}
    
    all_metrics = {}
    
    # Find all CSV files
    csv_files = [f for f in os.listdir(audit_dir) if f.endswith('.csv')]
    
    if not csv_files:
        logger.debug(f"No audit files found in {audit_dir}")
        return {}
    
    logger.info(f"Processing {len(csv_files)} audit files...")
    
    for filename in csv_files:
        uuid = filename.replace('.csv', '')
        file_path = os.path.join(audit_dir, filename)
        
        metrics = process_audit_log(file_path, uuid)
        if metrics:
            all_metrics[uuid] = metrics
    
    logger.info(f"Processed {len(all_metrics)} audit files successfully")
    return all_metrics


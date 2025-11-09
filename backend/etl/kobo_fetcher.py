"""
KoboToolbox API Fetcher
Fetches submissions and audit logs from KoboToolbox API.
"""

import os
import requests
import time
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class KoboFetcher:
    """Fetches data from KoboToolbox API."""
    
    def __init__(self, api_token: str, api_url: str = "https://kf.kobotoolbox.org/api/v2"):
        """
        Initialize Kobo fetcher.
        
        Args:
            api_token: KoboToolbox API token
            api_url: Base URL for KoboToolbox API (default: kf.kobotoolbox.org)
        """
        self.api_token = api_token
        self.api_url = api_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Token {api_token}',
            'Content-Type': 'application/json'
        })
    
    def _make_request(self, endpoint: str, params: Optional[Dict] = None, max_retries: int = 3) -> Dict[str, Any]:
        """
        Make API request with retry logic.
        
        Args:
            endpoint: API endpoint (relative to base URL)
            params: Query parameters
            max_retries: Maximum number of retry attempts
            
        Returns:
            JSON response as dictionary
        """
        url = f"{self.api_url}/{endpoint.lstrip('/')}"
        
        for attempt in range(max_retries):
            try:
                response = self.session.get(url, params=params, timeout=30)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # Exponential backoff
                    logger.warning(f"Request failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"Request failed after {max_retries} attempts: {e}")
                    raise
    
    def get_asset_submissions(
        self,
        asset_uid: str,
        start: Optional[datetime] = None,
        limit: int = 30000,
        query: Optional[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetch all submissions for a given asset (survey).
        
        Args:
            asset_uid: KoboToolbox asset UID
            start: Only fetch submissions after this datetime (optional)
            limit: Maximum number of submissions to fetch
            query: Additional query parameters
            
        Returns:
            List of submission dictionaries
        """
        all_submissions = []
        
        # Handle None limit - use a large default or no limit
        effective_limit = limit if limit is not None else None
        
        params = {
            'format': 'json',
            'limit': min(effective_limit, 30000) if effective_limit is not None else 30000,  # Kobo API max is 30000
        }
        
        if start:
            # Kobo uses format: ?start=2023-10-01T00:00:00
            params['start'] = start.strftime('%Y-%m-%dT%H:%M:%S')
        
        if query:
            params.update(query)
        
        offset = 0
        page_size = 1000  # Reasonable page size
        
        logger.info(f"Fetching submissions for asset {asset_uid}...")
        
        while effective_limit is None or len(all_submissions) < effective_limit:
            params['start'] = offset
            if effective_limit is not None:
                params['limit'] = min(page_size, effective_limit - len(all_submissions))
            else:
                params['limit'] = page_size
            
            try:
                response = self._make_request(f'/assets/{asset_uid}/data/', params=params)
                
                # Kobo API returns results in 'results' key
                submissions = response.get('results', [])
                
                if not submissions:
                    break
                
                all_submissions.extend(submissions)
                logger.info(f"Fetched {len(submissions)} submissions (total: {len(all_submissions)})")
                
                # Check if there are more results
                if len(submissions) < page_size:
                    break
                
                offset += len(submissions)
                
                # Rate limiting: be nice to the API
                time.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Error fetching submissions: {e}")
                break
        
        logger.info(f"Total submissions fetched: {len(all_submissions)}")
        if effective_limit is not None:
            return all_submissions[:effective_limit]
        return all_submissions
    
    def get_submission_audit_url(self, submission: Dict[str, Any]) -> Optional[str]:
        """
        Extract audit log URL from submission data.
        
        Args:
            submission: Submission dictionary from Kobo API
            
        Returns:
            Audit log URL or None if not available
        """
        # Audit URL is typically in the submission metadata
        return submission.get('_audit_URL') or submission.get('audit_URL')
    
    def download_audit_log(self, audit_url: str, output_path: str) -> bool:
        """
        Download audit log CSV file.
        
        Args:
            audit_url: URL to the audit log CSV
            output_path: Local path to save the file
            
        Returns:
            True if successful, False otherwise
        """
        try:
            response = self.session.get(audit_url, timeout=30, stream=True)
            response.raise_for_status()
            
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.debug(f"Downloaded audit log to {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download audit log from {audit_url}: {e}")
            return False
    
    def get_asset_info(self, asset_uid: str) -> Dict[str, Any]:
        """
        Get asset (survey) information.
        
        Args:
            asset_uid: KoboToolbox asset UID
            
        Returns:
            Asset information dictionary
        """
        return self._make_request(f'/assets/{asset_uid}/')


def create_fetcher_from_env() -> KoboFetcher:
    """
    Create KoboFetcher instance from environment variables.
    
    Returns:
        Configured KoboFetcher instance
        
    Raises:
        ValueError: If required environment variables are missing
    """
    api_token = os.getenv('KOBO_API_TOKEN')
    api_url = os.getenv('KOBO_API_URL', 'https://kf.kobotoolbox.org/api/v2')
    
    if not api_token:
        raise ValueError("KOBO_API_TOKEN environment variable is required")
    
    return KoboFetcher(api_token=api_token, api_url=api_url)


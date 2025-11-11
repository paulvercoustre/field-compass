#!/usr/bin/env python3
"""
Show Audit URLs from Kobo
Fetches submissions from Kobo and shows their audit URLs.
This helps debug what audit URLs are available before ETL processing.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from etl.kobo_fetcher import create_fetcher_from_env
from etl.data_merger import parse_kobo_submission


def show_audit_urls_from_kobo(asset_uid: str, limit: int = 10):
    """Fetch submissions from Kobo and show their audit URLs."""
    try:
        fetcher = create_fetcher_from_env()
    except ValueError as e:
        print(f"❌ Error: {e}")
        print("   Make sure KOBO_API_TOKEN is set in your environment or .env file")
        return
    
    print(f"Fetching submissions from Kobo asset: {asset_uid}")
    print(f"Limit: {limit} submissions")
    print()
    
    try:
        submissions = fetcher.get_asset_submissions(asset_uid=asset_uid, limit=limit)
        
        print(f"Found {len(submissions)} submission(s)")
        print()
        
        submissions_with_audit = 0
        submissions_without_audit = 0
        
        for i, kobo_sub in enumerate(submissions, 1):
            parsed = parse_kobo_submission(kobo_sub)
            uuid = parsed['_uuid']
            audit_url = parsed.get('audit_url')
            
            print(f"{i}. Submission UUID: {uuid}")
            print(f"   Submission ID: {kobo_sub.get('_id', 'N/A')}")
            
            if audit_url:
                submissions_with_audit += 1
                print(f"   ✅ Audit URL: {audit_url}")
            else:
                submissions_without_audit += 1
                print(f"   ❌ No audit URL")
                # Check if _audit_URL exists in raw data
                raw_audit_url = kobo_sub.get('_audit_URL') or kobo_sub.get('audit_URL')
                if raw_audit_url:
                    print(f"      (Found in raw data but not parsed: {raw_audit_url})")
            
            print()
        
        print("Summary:")
        print(f"  Submissions with audit URLs: {submissions_with_audit}")
        print(f"  Submissions without audit URLs: {submissions_without_audit}")
        print()
        print("Note: Audit URLs are only available if audit logging is enabled in Kobo.")
        
    except Exception as e:
        print(f"❌ Error fetching submissions: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Show audit URLs from Kobo submissions")
    parser.add_argument("asset_uid", help="Kobo asset UID")
    parser.add_argument("--limit", type=int, default=10, help="Maximum number of submissions to check (default: 10)")
    
    args = parser.parse_args()
    
    show_audit_urls_from_kobo(args.asset_uid, args.limit)


#!/usr/bin/env python3
"""
Check Audit Files
Lists all downloaded audit files and their status.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from etl.audit_processor import get_audit_dir, process_audit_log


def list_audit_files():
    """List all audit files in the audit directory."""
    audit_dir = get_audit_dir()
    
    print(f"Audit Directory: {audit_dir}")
    print(f"Directory exists: {os.path.exists(audit_dir)}")
    print()
    
    if not os.path.exists(audit_dir):
        print("❌ Audit directory does not exist!")
        return
    
    # List all CSV files
    csv_files = [f for f in os.listdir(audit_dir) if f.endswith('.csv')]
    
    if not csv_files:
        print("❌ No audit files found in directory")
        return
    
    print(f"✅ Found {len(csv_files)} audit file(s):")
    print()
    
    total_size = 0
    processed_count = 0
    
    for filename in sorted(csv_files):
        uuid = filename.replace('.csv', '')
        file_path = os.path.join(audit_dir, filename)
        file_size = os.path.getsize(file_path)
        total_size += file_size
        
        # Try to process the file to get metrics
        metrics = process_audit_log(file_path, uuid)
        
        if metrics:
            processed_count += 1
            active_time = metrics.get('active_interview_time', 'N/A')
            total_duration = metrics.get('total_duration', 'N/A')
            jump_count = metrics.get('jump_count', 'N/A')
            
            print(f"  📄 {filename}")
            print(f"     UUID: {uuid}")
            print(f"     Size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")
            print(f"     Active Interview Time: {active_time} minutes")
            print(f"     Total Duration: {total_duration:.2f} minutes" if isinstance(total_duration, (int, float)) else f"     Total Duration: {total_duration}")
            print(f"     Jump Count: {jump_count}")
            print()
        else:
            print(f"  ⚠️  {filename} (failed to process)")
            print(f"     UUID: {uuid}")
            print(f"     Size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")
            print()
    
    print(f"Summary:")
    print(f"  Total files: {len(csv_files)}")
    print(f"  Successfully processed: {processed_count}")
    print(f"  Failed to process: {len(csv_files) - processed_count}")
    print(f"  Total size: {total_size:,} bytes ({total_size / 1024:.2f} KB)")


def check_specific_uuid(uuid: str):
    """Check if a specific UUID has an audit file."""
    audit_dir = get_audit_dir()
    file_path = os.path.join(audit_dir, f"{uuid}.csv")
    
    print(f"Checking for UUID: {uuid}")
    print(f"Expected file: {file_path}")
    print()
    
    if os.path.exists(file_path):
        file_size = os.path.getsize(file_path)
        print(f"✅ Audit file exists!")
        print(f"   Size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")
        
        # Try to process
        metrics = process_audit_log(file_path, uuid)
        if metrics:
            print(f"   Active Interview Time: {metrics.get('active_interview_time')} minutes")
            print(f"   Total Duration: {metrics.get('total_duration'):.2f} minutes" if isinstance(metrics.get('total_duration'), (int, float)) else f"   Total Duration: {metrics.get('total_duration')}")
            print(f"   Jump Count: {metrics.get('jump_count')}")
        else:
            print(f"   ⚠️  File exists but failed to process")
    else:
        print(f"❌ Audit file not found")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Check audit files")
    parser.add_argument("--uuid", help="Check specific UUID")
    
    args = parser.parse_args()
    
    if args.uuid:
        check_specific_uuid(args.uuid)
    else:
        list_audit_files()


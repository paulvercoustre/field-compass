#!/usr/bin/env python3
"""
Compare Submissions for Edit Detection
Fetches two submissions from Kobo (one edited, one not) and compares their metadata
to identify what fields indicate an edit.
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from etl.data_merger import parse_kobo_submission
from etl.kobo_fetcher import create_fetcher_from_env


def format_datetime(dt: Any) -> str:
    """Format datetime for display."""
    if isinstance(dt, datetime):
        return dt.isoformat()
    elif isinstance(dt, str):
        return dt
    else:
        return str(dt)


def compare_metadata(edited_sub: dict[str, Any], non_edited_sub: dict[str, Any], asset_uid: str):
    """Compare metadata between edited and non-edited submissions."""

    print("=" * 80)
    print("COMPARING SUBMISSIONS FOR EDIT DETECTION")
    print("=" * 80)
    print()

    # Print full JSON responses first
    print("=" * 80)
    print("FULL JSON RESPONSE - EDITED SUBMISSION")
    print("=" * 80)
    print(json.dumps(edited_sub, indent=2, default=str))
    print()

    print("=" * 80)
    print("FULL JSON RESPONSE - NON-EDITED SUBMISSION")
    print("=" * 80)
    print(json.dumps(non_edited_sub, indent=2, default=str))
    print()

    # Parse both submissions
    parsed_edited = parse_kobo_submission(edited_sub)
    parsed_non_edited = parse_kobo_submission(non_edited_sub)

    print("EDITED SUBMISSION:")
    print("-" * 80)
    print(f"  _id: {edited_sub.get('_id')}")
    print(f"  _uuid: {parsed_edited['_uuid']}")
    print(f"  _submission_time: {format_datetime(parsed_edited['_submission_time'])}")
    print(f"  end: {format_datetime(parsed_edited['end'])}")
    print(f"  _validation_status: {edited_sub.get('_validation_status')}")
    print()

    print("NON-EDITED SUBMISSION:")
    print("-" * 80)
    print(f"  _id: {non_edited_sub.get('_id')}")
    print(f"  _uuid: {parsed_non_edited['_uuid']}")
    print(f"  _submission_time: {format_datetime(parsed_non_edited['_submission_time'])}")
    print(f"  end: {format_datetime(parsed_non_edited['end'])}")
    print(f"  _validation_status: {non_edited_sub.get('_validation_status')}")
    print()

    print("=" * 80)
    print("METADATA COMPARISON")
    print("=" * 80)
    print()

    # Compare key metadata fields
    metadata_fields = [
        "_id",
        "_uuid",
        "_submission_time",
        "end",
        "_validation_status",
        "_edited",
        "_modified",
        "_attachments",
        "_audit_URL",
        "audit_URL",
    ]

    differences = []
    similarities = []

    for field in metadata_fields:
        edited_val = edited_sub.get(field)
        non_edited_val = non_edited_sub.get(field)

        if edited_val != non_edited_val:
            differences.append({"field": field, "edited": edited_val, "non_edited": non_edited_val})
        else:
            similarities.append({"field": field, "value": edited_val})

    print("DIFFERENCES (Fields that differ between edited and non-edited):")
    print("-" * 80)
    if differences:
        for diff in differences:
            print(f"  {diff['field']}:")
            print(f"    Edited:   {diff['edited']}")
            print(f"    Non-edit: {diff['non_edited']}")
            print()
    else:
        print("  No differences found in common metadata fields")
    print()

    print("SIMILARITIES (Fields that are the same):")
    print("-" * 80)
    for sim in similarities[:10]:  # Show first 10
        print(f"  {sim['field']}: {sim['value']}")
    if len(similarities) > 10:
        print(f"  ... and {len(similarities) - 10} more similar fields")
    print()

    # Check for UUID changes and deprecatedID
    print("=" * 80)
    print("UUID & EDIT DETECTION ANALYSIS")
    print("=" * 80)
    print()

    edited_uuid = parsed_edited["_uuid"]
    non_edited_uuid = parsed_non_edited["_uuid"]

    # Check for deprecatedID (KEY FINDING!)
    edited_deprecated_id = edited_sub.get("meta/deprecatedID") or edited_sub.get("meta", {}).get(
        "deprecatedID"
    )
    non_edited_deprecated_id = non_edited_sub.get("meta/deprecatedID") or non_edited_sub.get(
        "meta", {}
    ).get("deprecatedID")

    print("🔍 KEY FINDING: meta/deprecatedID field")
    print("-" * 80)
    if edited_deprecated_id:
        print(f"✅ EDITED submission HAS deprecatedID: {edited_deprecated_id}")
        print("   This is the OLD UUID before the edit!")
        print(f"   Current UUID: {edited_uuid}")
        print(f"   Old UUID (deprecatedID): {edited_deprecated_id}")
    else:
        print("❌ EDITED submission does NOT have deprecatedID")

    if non_edited_deprecated_id:
        print(f"⚠️  NON-EDITED submission HAS deprecatedID: {non_edited_deprecated_id}")
        print("   (This is unexpected - might indicate it was also edited)")
    else:
        print("✅ NON-EDITED submission does NOT have deprecatedID (expected)")
    print()

    print("UUID Comparison:")
    print("-" * 80)
    if edited_uuid != non_edited_uuid:
        print("✅ UUIDs are DIFFERENT (expected - they're different submissions)")
        print(f"   Edited UUID:   {edited_uuid}")
        print(f"   Non-edit UUID: {non_edited_uuid}")
    else:
        print("⚠️  UUIDs are the SAME (unexpected for different submissions)")
        print(f"   Both UUIDs: {edited_uuid}")
    print()

    # Check meta/rootUuid and meta/instanceID
    edited_root_uuid = edited_sub.get("meta/rootUuid") or edited_sub.get("meta", {}).get("rootUuid")
    edited_instance_id = edited_sub.get("meta/instanceID") or edited_sub.get("meta", {}).get(
        "instanceID"
    )
    non_edited_root_uuid = non_edited_sub.get("meta/rootUuid") or non_edited_sub.get(
        "meta", {}
    ).get("rootUuid")
    non_edited_instance_id = non_edited_sub.get("meta/instanceID") or non_edited_sub.get(
        "meta", {}
    ).get("instanceID")

    print("Meta UUID Fields:")
    print("-" * 80)
    print("EDITED submission:")
    print(f"  meta/rootUuid: {edited_root_uuid}")
    print(f"  meta/instanceID: {edited_instance_id}")
    print(f"  _uuid: {edited_uuid}")
    if edited_deprecated_id:
        print(f"  meta/deprecatedID: {edited_deprecated_id}")
        if edited_root_uuid and edited_deprecated_id.replace("uuid:", "") in edited_root_uuid:
            print("  ✅ rootUuid matches deprecatedID (points to original UUID)")
    print()
    print("NON-EDITED submission:")
    print(f"  meta/rootUuid: {non_edited_root_uuid}")
    print(f"  meta/instanceID: {non_edited_instance_id}")
    print(f"  _uuid: {non_edited_uuid}")
    if non_edited_root_uuid and non_edited_uuid in non_edited_root_uuid:
        print("  ✅ rootUuid matches current UUID (no edit)")
    print()

    # Check timestamp differences
    print("=" * 80)
    print("TIMESTAMP ANALYSIS")
    print("=" * 80)
    print()

    edited_submission_time = parsed_edited["_submission_time"]
    edited_end = parsed_edited["end"]
    non_edited_submission_time = parsed_non_edited["_submission_time"]
    non_edited_end = parsed_non_edited["end"]

    # Calculate time differences
    if isinstance(edited_submission_time, datetime) and isinstance(edited_end, datetime):
        edited_duration = (edited_end - edited_submission_time).total_seconds()
        print(
            f"Edited submission duration: {edited_duration:.1f} seconds ({edited_duration/60:.1f} minutes)"
        )

    if isinstance(non_edited_submission_time, datetime) and isinstance(non_edited_end, datetime):
        non_edited_duration = (non_edited_end - non_edited_submission_time).total_seconds()
        print(
            f"Non-edited submission duration: {non_edited_duration:.1f} seconds ({non_edited_duration/60:.1f} minutes)"
        )

    print()
    print("Current logic compares 'end' with '_submission_time + 300s':")
    if isinstance(edited_submission_time, datetime) and isinstance(edited_end, datetime):
        time_diff = (edited_end - edited_submission_time).total_seconds()
        would_be_edited = time_diff > 300
        print(f"  Edited submission: end - _submission_time = {time_diff:.1f}s")
        print(f"  Would be marked as edited: {would_be_edited}")

    if isinstance(non_edited_submission_time, datetime) and isinstance(non_edited_end, datetime):
        time_diff = (non_edited_end - non_edited_submission_time).total_seconds()
        would_be_edited = time_diff > 300
        print(f"  Non-edited submission: end - _submission_time = {time_diff:.1f}s")
        print(f"  Would be marked as edited: {would_be_edited}")
    print()

    # Check for all metadata fields in both submissions
    print("=" * 80)
    print("ALL METADATA FIELDS (Fields starting with _)")
    print("=" * 80)
    print()

    edited_metadata = {k: v for k, v in edited_sub.items() if k.startswith("_")}
    non_edited_metadata = {k: v for k, v in non_edited_sub.items() if k.startswith("_")}

    set(edited_metadata.keys()) | set(non_edited_metadata.keys())

    print("Metadata fields in edited submission:")
    for field in sorted(edited_metadata.keys()):
        print(f"  {field}: {edited_metadata[field]}")
    print()

    print("Metadata fields in non-edited submission:")
    for field in sorted(non_edited_metadata.keys()):
        print(f"  {field}: {non_edited_metadata[field]}")
    print()

    # Check for data changes (compare submission_data)
    print("=" * 80)
    print("DATA CONTENT COMPARISON")
    print("=" * 80)
    print()

    edited_data = parsed_edited["submission_data"]
    non_edited_data = parsed_non_edited["submission_data"]

    # Remove metadata fields for comparison
    edited_data_clean = {k: v for k, v in edited_data.items() if not k.startswith("_")}
    non_edited_data_clean = {k: v for k, v in non_edited_data.items() if not k.startswith("_")}

    edited_keys = set(edited_data_clean.keys())
    non_edited_keys = set(non_edited_data_clean.keys())

    common_keys = edited_keys & non_edited_keys
    only_in_edited = edited_keys - non_edited_keys
    only_in_non_edited = non_edited_keys - edited_keys

    print(f"Common data fields: {len(common_keys)}")
    print(f"Fields only in edited: {len(only_in_edited)}")
    print(f"Fields only in non-edited: {len(only_in_non_edited)}")
    print()

    # Find fields with different values
    data_differences = []
    for key in common_keys:
        if edited_data_clean[key] != non_edited_data_clean[key]:
            data_differences.append(
                {
                    "field": key,
                    "edited": edited_data_clean[key],
                    "non_edited": non_edited_data_clean[key],
                }
            )

    if data_differences:
        print(f"Data fields with different values: {len(data_differences)}")
        for diff in data_differences[:10]:  # Show first 10
            print(f"  {diff['field']}:")
            print(f"    Edited:   {diff['edited']}")
            print(f"    Non-edit: {diff['non_edited']}")
        if len(data_differences) > 10:
            print(f"  ... and {len(data_differences) - 10} more differences")
    else:
        print("No data field differences found (these might be from different surveys)")
    print()

    # Recommendations
    print("=" * 80)
    print("RECOMMENDATIONS FOR EDIT DETECTION")
    print("=" * 80)
    print()

    recommendations = []

    # KEY FINDING: Check for deprecatedID
    if edited_deprecated_id:
        recommendations.append(
            "🎯 PRIMARY INDICATOR: 'meta/deprecatedID' field exists = submission was edited!"
        )
        recommendations.append("   - If meta/deprecatedID exists, submission was definitely edited")
        recommendations.append("   - deprecatedID contains the previous UUID before edit")
        recommendations.append("   - Current _uuid is the new UUID after edit")
    else:
        recommendations.append("⚠️  No 'meta/deprecatedID' found in edited submission (unexpected)")

    if non_edited_deprecated_id:
        recommendations.append(
            "⚠️  Non-edited submission has deprecatedID (unexpected - might be edited too)"
        )
    else:
        recommendations.append("✅ Non-edited submission correctly has no deprecatedID")

    # Check UUID change
    if edited_deprecated_id:
        recommendations.append(
            "✅ UUID changes on edit - new UUID in _uuid, old UUID in meta/deprecatedID"
        )
    elif edited_uuid != non_edited_uuid:
        recommendations.append(
            "✅ UUIDs are different (but these are different submissions, not edit indicator)"
        )
    else:
        recommendations.append("⚠️  UUID does NOT change on edit - cannot rely on UUID alone")

    # Check timestamp issues
    recommendations.append("⚠️  Timestamp comparison is SKETCHY:")
    recommendations.append("   - 'end' field has timezone info (e.g., '+04:30')")
    recommendations.append("   - '_submission_time' does NOT have timezone info")
    recommendations.append(
        "   - Cannot reliably compare end vs _submission_time due to timezone mismatch"
    )
    recommendations.append("   - Should compare new_end with existing.end (both from same source)")

    # Check for explicit edit metadata
    if "_edited" in edited_sub or "_modified" in edited_sub:
        recommendations.append(
            "✅ Found explicit edit metadata field - use this as additional indicator"
        )
    else:
        recommendations.append(
            "ℹ️  No explicit '_edited' or '_modified' field (use deprecatedID instead)"
        )

    for rec in recommendations:
        print(f"  {rec}")
    print()

    print("=" * 80)
    print("SUGGESTED EDIT DETECTION LOGIC")
    print("=" * 80)
    print()
    print("Based on the comparison, use this approach:")
    print()
    print("🎯 PRIMARY METHOD: Check for meta/deprecatedID")
    print("   - If 'meta/deprecatedID' field exists in Kobo JSON → submission was edited")
    print("   - This is the most reliable indicator from Kobo")
    print("   - deprecatedID contains the previous UUID")
    print("   - Current _uuid is the new UUID after edit")
    print()
    print("2. UUID comparison with database:")
    print("   - When submission exists in DB (lookup by _id):")
    print("   - Compare new _uuid with existing._uuid in database")
    print("   - If UUID changed → submission was edited")
    print("   - Note: deprecatedID tells you the old UUID, but comparing with DB is also reliable")
    print()
    print("3. Data change detection (JSON diff):")
    print("   - Always calculate JSON diff when submission exists")
    print("   - Compare new submission_data with existing.submission_data")
    print("   - If diff is non-empty → submission was edited")
    print("   - This catches edits even if UUID didn't change (edge case)")
    print()
    print("4. End timestamp comparison (SECONDARY, less reliable):")
    print("   - Compare new_end with existing.end (NOT _submission_time)")
    print("   - ⚠️  WARNING: Timezone issues make this less reliable")
    print("   - Use only as additional signal, not primary method")
    print()
    print("✅ RECOMMENDED COMBINED APPROACH:")
    print("   1. Check if 'meta/deprecatedID' exists → if yes, definitely edited")
    print("   2. If submission exists in DB, check if UUID changed → if yes, edited")
    print("   3. Calculate JSON diff → if non-empty, edited")
    print("   4. Mark as edited if ANY of the above is true")
    print()


def fetch_and_compare(uuid_edited: str, uuid_non_edited: str, asset_uid: str):
    """Fetch two submissions by UUID and compare them."""
    try:
        fetcher = create_fetcher_from_env()
        print("✅ KoboFetcher initialized successfully")
    except ValueError as e:
        print(f"❌ Error: {e}")
        print("   Make sure KOBO_API_TOKEN is set in your environment or .env file")
        return
    except Exception as e:
        print(f"❌ Error creating fetcher: {e}")
        import traceback

        traceback.print_exc()
        return

    print(f"Fetching submissions from Kobo asset: {asset_uid}")
    print(f"Edited submission UUID: {uuid_edited}")
    print(f"Non-edited submission UUID: {uuid_non_edited}")
    print()

    # Fetch edited submission
    print("Fetching edited submission...")
    try:
        edited_sub = fetcher.get_submission_by_uuid(asset_uid, uuid_edited)
        if not edited_sub:
            print(f"⚠️  Could not find edited submission with UUID query: {uuid_edited}")
            print("   Trying to fetch all submissions and search...")
            # Fallback: fetch all and search
            all_subs = fetcher.get_asset_submissions(asset_uid, limit=10000)
            print(f"   Fetched {len(all_subs)} submissions, searching for UUID...")
            for sub in all_subs:
                parsed = parse_kobo_submission(sub)
                if parsed["_uuid"] == uuid_edited:
                    edited_sub = sub
                    print(f"   ✅ Found edited submission in batch (ID: {sub.get('_id')})")
                    break
            if not edited_sub:
                print(f"❌ Could not find edited submission with UUID: {uuid_edited}")
                print("   Please verify the UUID is correct")
                return
        else:
            print(f"✅ Found edited submission (ID: {edited_sub.get('_id')})")
    except Exception as e:
        print(f"❌ Error fetching edited submission: {e}")
        import traceback

        traceback.print_exc()
        return

    # Fetch non-edited submission
    print("Fetching non-edited submission...")
    try:
        non_edited_sub = fetcher.get_submission_by_uuid(asset_uid, uuid_non_edited)
        if not non_edited_sub:
            print(f"⚠️  Could not find non-edited submission with UUID query: {uuid_non_edited}")
            print("   Trying to fetch all submissions and search...")
            # Fallback: fetch all and search
            all_subs = fetcher.get_asset_submissions(asset_uid, limit=10000)
            print(f"   Fetched {len(all_subs)} submissions, searching for UUID...")
            for sub in all_subs:
                parsed = parse_kobo_submission(sub)
                if parsed["_uuid"] == uuid_non_edited:
                    non_edited_sub = sub
                    print(f"   ✅ Found non-edited submission in batch (ID: {sub.get('_id')})")
                    break
            if not non_edited_sub:
                print(f"❌ Could not find non-edited submission with UUID: {uuid_non_edited}")
                print("   Please verify the UUID is correct")
                return
        else:
            print(f"✅ Found non-edited submission (ID: {non_edited_sub.get('_id')})")
    except Exception as e:
        print(f"❌ Error fetching non-edited submission: {e}")
        import traceback

        traceback.print_exc()
        return

    print()
    print("✅ Both submissions found!")
    print()

    # Compare them
    compare_metadata(edited_sub, non_edited_sub, asset_uid)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Compare two Kobo submissions to identify edit detection indicators",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python compare_submissions.py a1b2c3d4 e5f6g7h8 --asset-uid abc123
        """,
    )
    parser.add_argument("uuid_edited", help="UUID of the edited submission")
    parser.add_argument("uuid_non_edited", help="UUID of the non-edited submission")
    parser.add_argument("--asset-uid", required=True, help="Kobo asset UID (required)")

    args = parser.parse_args()

    fetch_and_compare(args.uuid_edited, args.uuid_non_edited, args.asset_uid)

# Code Changes Review - Validation Rules & Audit Processing

## Overview
This document reviews all changes made to fix validation rules evaluation and implement audit log processing for active interview time calculation.

## ✅ All Tests Passing
**40 tests passed** - All existing tests continue to pass, plus new tests for audit processing.

---

## 1. Validation Rules Fixes

### Problem
Validation rules were not generating flags because:
- String values weren't properly quoted in expressions
- Logical operators (`&`, `|`) weren't converted to Python (`and`, `or`)
- Quotes in expressions were rejected by the safety check

### Solution
**File**: `backend/etl/hfc_engine.py`

#### Changes to `_safe_eval()` method (lines 427-490):
1. **String Quoting**: Properly quotes string values and escapes internal quotes
   ```python
   if isinstance(value, str):
       escaped_value = value.replace('"', '\\"')
       replacement = f'"{escaped_value}"'
   ```

2. **Operator Conversion**: Converts frontend operators to Python operators
   ```python
   expression = re.sub(r'\s+&\s+', ' and ', expression)
   expression = re.sub(r'\s+\|\s+', ' or ', expression)
   ```

3. **Safety Check**: Updated to allow quotes in expressions
   ```python
   safe_chars = set('... "\' ...')  # Now includes quotes
   ```

4. **Debug Logging**: Added extensive logging for troubleshooting

### Tests
**File**: `backend/tests/test_validation_rules.py`
- ✅ String comparison rules
- ✅ Numeric comparison rules
- ✅ AND/OR operator rules
- ✅ Path-based field rules
- ✅ Inactive rule handling

---

## 2. Duration Check Fixes

### Problem
Duration check wasn't working because it tried to find `start` and `end` timestamps in `submission_data`, but they're stored as metadata on the `SubmissionCurrent` object.

### Solution
**File**: `backend/etl/hfc_engine.py`

#### Changes:
1. **Updated `run_checks()` signature** (line 94):
   - Added `start_time: Optional[datetime] = None`
   - Added `end_time: Optional[datetime] = None`

2. **Updated `_run_basic_checks()` signature** (line 123):
   - Added `start_time` and `end_time` parameters
   - Passes them to `_check_duration()`

3. **Updated `_check_duration()` method** (line 222):
   - **Priority 1**: Uses `active_interview_time` from audit logs (if available)
   - **Priority 2**: Uses provided `start_time`/`end_time` from metadata
   - **Priority 3**: Fallback to `start_time_field`/`end_time_field` from submission data

**File**: `backend/etl/pipeline.py`

#### Changes:
1. **`run_pipeline()` method** (line 142):
   - Passes `submission._submission_time` and `submission.end` to `run_checks()`

2. **`process_single_submission()` method** (line 253):
   - Passes `submission._submission_time` and `submission.end` to `run_checks()`

### Tests
**File**: `backend/tests/test_hfc_engine.py`
- ✅ `test_duration_too_short`
- ✅ `test_duration_too_long`
- ✅ `test_duration_within_range`

---

## 3. Audit Log Processing Implementation

### New Module
**File**: `backend/etl/audit_processor.py`

#### Functions:
1. **`download_audit_log()`** (line 30):
   - Downloads audit CSV from Kobo
   - Skips if file already exists
   - Stores in `backend/data/audits/{uuid}.csv`

2. **`process_audit_log()`** (line 77):
   - Reads audit CSV file
   - Calculates metrics:
     - `active_interview_time`: Sum of question event durations (minutes)
     - `total_duration`: Total form duration (minutes)
     - `jump_count`: Number of jump events
     - `median_question_time`: Median time per question (seconds)

3. **`download_and_process_audit()`** (line 178):
   - Convenience function that downloads and processes

4. **`get_audit_dir()`** (line 20):
   - Gets/creates audit directory
   - Configurable via `AUDIT_DIR` environment variable

### Integration
**File**: `backend/etl/pipeline.py`

#### Changes:
1. **Import** (line 15):
   ```python
   from etl.audit_processor import download_and_process_audit
   ```

2. **In `run_pipeline()`** (lines 108-122):
   - Downloads and processes audit log before merging submission
   - Adds `active_interview_time` to `submission_data`
   - Handles errors gracefully (logs warning, continues)

3. **In `process_single_submission()`** (lines 227-240):
   - Same audit processing logic

### Storage
- **Directory**: `backend/data/audits/` (bind-mounted in Docker, persists)
- **Format**: CSV files named `{uuid}.csv`
- **Gitignore**: Added to `.gitignore` (line 79)

### Tests
**File**: `backend/tests/test_audit_processor.py`
- ✅ Question event processing
- ✅ Jump counting
- ✅ Median calculation
- ✅ Error handling (missing/empty files)
- ✅ Directory creation

---

## 4. Data Flow

### Complete Flow:
```
1. ETL Pipeline fetches submissions from Kobo
   ↓
2. Parse submission (extract audit_url)
   ↓
3. Download audit log (if audit_url exists)
   ↓
4. Process audit log → calculate active_interview_time
   ↓
5. Add active_interview_time to submission_data
   ↓
6. Merge submission to database
   ↓
7. Run HFC checks:
   - Duration check uses active_interview_time (if available)
   - Falls back to start_time/end_time from metadata
   - Falls back to start_time_field/end_time_field from data
   ↓
8. Store quality issues
```

---

## 5. Key Integration Points

### ✅ Verified:
1. **Audit URL Extraction**: `data_merger.py` line 143 extracts `_audit_URL`
2. **Audit Processing**: `pipeline.py` processes audits before merging
3. **Active Time Storage**: Added to `submission_data` before merge
4. **Duration Check**: `hfc_engine.py` uses `active_interview_time` with proper priority
5. **Metadata Passing**: `start_time` and `end_time` passed from `SubmissionCurrent` object
6. **Error Handling**: Graceful degradation if audit processing fails

---

## 6. Dependencies

### Required Packages:
- ✅ `requests` (already in `requirements.txt` line 8)
- ✅ All other dependencies unchanged

### Environment Variables:
- `KOBO_API_TOKEN`: Required for downloading audit logs
- `AUDIT_DIR`: Optional, defaults to `backend/data/audits/`

---

## 7. Docker Compatibility

### ✅ Verified:
- Audit files stored in `backend/data/audits/`
- Directory is bind-mounted in `docker-compose.yml` (line 43: `./backend:/app`)
- Files persist across container restarts
- Directory auto-created if missing

---

## 8. Backwards Compatibility

### ✅ Maintained:
- Duration check has 3-tier fallback (audit → metadata → data fields)
- Existing submissions without audit logs continue to work
- Validation rules work with both old and new expression formats
- No breaking changes to API or database schema

---

## 9. Known Limitations / Future Improvements

1. **Expression Parser**: Current `_safe_eval()` is simplified
   - Issue created: GitHub issue for proper expression parser
   - Consider: Using `ast.literal_eval` or a proper expression library

2. **Audit File Management**: Currently keeps all files
   - Future: Could add cleanup for old files
   - Future: Could store in database instead of filesystem

3. **Error Recovery**: Audit processing failures are logged but don't block pipeline
   - This is intentional (graceful degradation)

---

## 10. Testing Summary

### Test Coverage:
- ✅ **40 tests passing** (all existing + new audit tests)
- ✅ Validation rules: 5 tests
- ✅ Duration checks: 3 tests
- ✅ Audit processing: 6 tests
- ✅ API endpoints: 10 tests
- ✅ Data merger: 8 tests
- ✅ HFC engine: 8 tests

### Test Files:
- `backend/tests/test_validation_rules.py` (new)
- `backend/tests/test_audit_processor.py` (new)
- `backend/tests/test_hfc_engine.py` (updated)
- All other tests unchanged

---

## Conclusion

✅ **All changes are properly integrated and tested**
✅ **No breaking changes**
✅ **Backwards compatible**
✅ **Docker compatible**
✅ **All tests passing**

The implementation is ready for production use. The validation rules now work correctly, duration checks use proper metadata, and audit log processing calculates active interview time as expected.


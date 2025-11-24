# Bug: Numerical Variable Comparisons Not Flagging in Quality Checks

## Problem Description

Quality checks involving numerical variables (integer, decimal, calculate) are not flagging submissions correctly when comparing variable values to static numerical values. For example, a rule like `income > 200` does not create flags even when the income value exceeds 200.

**Working correctly:**
- Quality checks with `select_one` and `select_multiple` questions work as expected
- String comparisons work correctly

**Not working:**
- Numerical comparisons (e.g., `income > 200`, `age < 18`, `score >= 100`)

## Root Cause

The issue stems from how Kobo API returns data. Numeric values are returned as **strings** (e.g., `"250"` instead of `250`). When evaluating expressions like `income > 200`:

1. The variable `income` contains the string value `"250"` from Kobo
2. The expression evaluator tries to compare `"250" > 200`
3. Python 3 raises a `TypeError` when comparing strings to integers, causing the evaluation to fail silently (caught by exception handler)

**Evidence:**
- In `backend/etl/data_merger.py` line 167, submission data is copied directly from Kobo without type conversion: `submission_data = {k: v for k, v in kobo_data.items()}`
- In `backend/etl/hfc_engine.py` lines 422-452, values are retrieved and used directly without type conversion
- The `_safe_eval` method (lines 480-524) uses `SimpleEval` which will fail when comparing strings to numbers

## Expected Behavior

When a quality check rule compares a numerical variable to a static numerical value:
- If the variable value (as a number) satisfies the condition, a flag should be created
- The comparison should work regardless of whether Kobo returns the value as a string or number

## Files Involved

1. **`backend/etl/hfc_engine.py`**
   - `_get_field_value()` method (lines 75-102): Retrieves field values but doesn't convert types
   - `_evaluate_rule()` method (lines 396-478): Evaluates rules but doesn't convert string numbers to actual numbers
   - `_safe_eval()` method (lines 480-524): Evaluates expressions but fails when comparing strings to numbers

2. **`backend/etl/data_merger.py`**
   - `parse_kobo_submission()` method (line 167): Copies Kobo data without type conversion

3. **`frontend/utils/file.ts`**
   - `compileRuleFromStructure()` function (lines 4-40): Compiles rules but doesn't indicate which variables are numeric

## Solution Approach

The fix should convert string values to numbers when:
1. The variable is known to be numeric (integer, decimal, or calculate type)
2. The string value can be successfully converted to a number
3. The conversion happens before expression evaluation

**Recommended implementation:**

1. **Option A (Preferred):** Add type conversion in `_evaluate_rule()` method before creating the evaluation context:
   - Check if variable type information is available (from survey config or variable metadata)
   - Convert string values to `int` or `float` if the variable is numeric
   - Handle conversion errors gracefully (skip conversion if value can't be converted)

2. **Option B:** Add type conversion in `_get_field_value()` method:
   - This would require access to variable type information
   - More invasive but would fix the issue at the source

3. **Option C:** Add type conversion in `parse_kobo_submission()`:
   - Would require survey config to determine which fields are numeric
   - Less flexible if variable types aren't known at parse time

## Test Cases

The fix should handle:

1. **Basic numeric comparison:**
   - Rule: `income > 200`
   - Submission: `{"income": "250"}` → Should flag
   - Submission: `{"income": "150"}` → Should not flag

2. **Decimal values:**
   - Rule: `score >= 95.5`
   - Submission: `{"score": "96.2"}` → Should flag
   - Submission: `{"score": "94.8"}` → Should not flag

3. **Mixed types in expression:**
   - Rule: `age > 18 & income < 1000`
   - Submission: `{"age": "20", "income": "500"}` → Should flag
   - Submission: `{"age": "20", "income": "2000"}` → Should not flag

4. **Invalid numeric strings:**
   - Submission: `{"income": "not_a_number"}` → Should skip evaluation (not crash)

5. **Already numeric values:**
   - Submission: `{"income": 250}` → Should still work (backward compatibility)

6. **Empty/null values:**
   - Submission: `{"income": ""}` or `{"income": null}` → Should skip (already handled)

## Implementation Notes

- The existing test file `backend/tests/test_validation_rules.py` has a test `test_numeric_comparison_rule()` (lines 52-86) that uses numeric values directly. This test passes because it uses integers, not strings. Consider adding a test case with string values to verify the fix.

- The variable type information might be available from:
  - Survey config (`survey_config.config_data.get('kobo_tool', {}).get('survey', [])`)
  - Or could be inferred from the variable name patterns
  - Or passed as metadata in the rule data

- Error handling: If conversion fails, log a warning and skip the conversion (use original value). This ensures backward compatibility.

## Related Code References

- `backend/etl/hfc_engine.py:396-478` - `_evaluate_rule()` method
- `backend/etl/hfc_engine.py:75-102` - `_get_field_value()` method  
- `backend/etl/hfc_engine.py:480-524` - `_safe_eval()` method
- `backend/tests/test_validation_rules.py:52-86` - Existing numeric comparison test
- `frontend/utils/file.ts:4-40` - Rule compilation logic


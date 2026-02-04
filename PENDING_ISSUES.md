# Pending Issues

## AI Rule Builder - Rule Not Being Saved (2026-01-28, Updated 2026-02-04)

**Issue**: When a user generates a rule using the AI Rule Builder and clicks "Accept & Add to Editor", the rule was not being added to the saved rules list.

**Root Cause**: 
The AI component's `handleAccept` function was showing a success message and clearing the generated rule immediately after calling `onRuleGenerated`, without waiting for the asynchronous save operation to complete. This meant:
1. If the save failed, the user would lose the generated rule with no way to recover it
2. The success message was misleading - it appeared before the save actually completed
3. Errors during save were not properly communicated to the user

**Solution Implemented**:
1. Made `onRuleGenerated` callback return a `Promise<void>` instead of `void`
2. Made `handleAccept` async and await the `onRuleGenerated` callback
3. Wrapped the save operation in try-catch to properly handle errors
4. Only show success message and clear the form after save completes successfully
5. Show error message in the AI component if save fails
6. Updated `handleAIRuleGenerated` to throw errors so they propagate to the AI component
7. Added loading state to disable buttons during save operation
8. Changed success message from "Rule added to editor successfully!" to "Rule saved successfully!" for clarity

**Files Modified**:
- `frontend/components/rule-builder/AINaturalLanguageInput.tsx` - Updated `handleAccept` to be async and properly handle save completion
- `frontend/pages/SurveySettingsPage.tsx` - Updated `handleAIRuleGenerated` to throw errors and directly call database functions

**Status**: ✅ COMPREHENSIVE FIX IMPLEMENTED (2026-02-04)

**Root Causes Identified**:
1. **Insufficient Context**: AI was not receiving existing rules, global parameters, or survey configuration
2. **Weak Prompts**: System prompt was not explicit enough about exact JSON structure required
3. **Missing Variable Types**: 'calculate' type variables were being excluded from the variable list
4. **Permission Too Restrictive**: Required 'owner' access instead of 'editor'
5. **No Duplicate Prevention**: Existing rules were not passed to AI, so it could suggest duplicates
6. **Async Flow Issue**: Frontend wasn't waiting for save to complete before showing success

**Comprehensive Fixes Applied**:

### 1. Frontend Fixes (`frontend/components/rule-builder/AINaturalLanguageInput.tsx`):
- Made `onRuleGenerated` callback async (returns `Promise<void>`)
- Made `handleAccept` function async and await the save operation
- Added proper error handling with try-catch
- Only show success message after save completes successfully
- Show errors in the AI component if save fails
- Added loading state to disable buttons during save
- Changed success message to "Rule saved successfully!"

### 2. Frontend Parent Component (`frontend/pages/SurveySettingsPage.tsx`):
- Updated `handleAIRuleGenerated` to directly call database functions instead of wrapping `handleSaveRule`
- Made it throw errors so they propagate back to the AI component
- Ensured the rules list refreshes after successful save

### 3. Backend Router (`backend/routers/ai.py`):
- **Changed Permission Check**: Now requires 'editor' instead of 'owner' for AI endpoints (editors should be able to create rules)
- **Pass Existing Rules**: Now fetches and passes active validation rules to AI service
- **Pass Survey Context**: Extracts and passes global_parameters, core_identifiers, special_values
- **Include Calculate Variables**: Fixed variable extraction to include 'calculate' type (was being skipped)
- Both `generate-rule` and `suggest-rules` endpoints updated

### 4. Backend AI Service (`backend/services/ai_service.py`):
- **Enhanced Function Signatures**: Added `existing_rules` and `survey_context` parameters
- **Improved System Prompt**: 
  - Much more explicit about exact JSON structure required
  - Added detailed examples of conditions array format
  - Explained operators, value types, and formatting rules
  - Added warnings about JSON syntax requirements
- **Enhanced User Prompt**:
  - Now includes survey variables with clear formatting
  - Includes existing rules to avoid duplicates
  - Includes survey configuration (duration limits, date ranges, special values)
  - Clearer instructions to return ONLY valid JSON
- **Both Functions Updated**: `generate_rule_from_text` and `suggest_rules`

### 5. Example Improvements:

**Before** (vague prompt):
```
Survey Variables:
- age: integer
- income: decimal

User Request: Flag if age is too high
```

**After** (comprehensive context):
```
SURVEY VARIABLES (name: type - label [choices if applicable]):
- age: integer (Respondent Age)
- income: decimal (Monthly Income)
- consent: select_one yes_no (Consent Given) [choices: yes, no]

EXISTING RULES (avoid creating duplicates):
- Income validation: income >= 0 & income < 1000000

SURVEY CONFIGURATION:
- Expected survey duration: 10-60 minutes
- Data collection period: 2026-01-01 to 2026-12-31
- Special values: DK numeric = -99, DK string = dk

USER REQUEST: Flag if age is too high

Generate a validation rule matching the exact JSON schema specified in the system prompt.
```

**Testing Recommendations**:
1. Test rule generation with a simple prompt: "Flag if age is greater than 100"
2. Test with existing rules to ensure no duplicates are suggested
3. Test rule suggestions to verify they use survey context
4. Test that editor users can now create rules (not just owners)
5. Verify rules are actually saved to database and appear in the UI

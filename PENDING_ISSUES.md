# Pending Issues

## AI Rule Builder - Rule Not Being Saved (2026-01-28)

**Issue**: When a user generates a rule using the AI Rule Builder and clicks "Accept & Add to Editor", the rule is not being added to the saved rules list.

**Expected Behavior**: 
- User generates a rule via AI
- Clicks "Accept & Add to Editor"
- Rule should be saved to the database
- Rule should appear in the "Saved Rules" list

**Current Behavior**:
- User generates a rule via AI
- Clicks "Accept & Add to Editor"
- Rule disappears but doesn't appear in saved rules

**Location**: 
- Frontend: `frontend/pages/SurveySettingsPage.tsx` - `handleAIRuleGenerated` function
- Frontend: `frontend/components/rule-builder/AINaturalLanguageInput.tsx`

**Likely Cause**: 
The `handleAIRuleGenerated` callback may not be properly saving the rule to the database or there's an issue with the `handleSaveRule` function when called from the AI component.

**Priority**: Medium

**Next Steps**:
1. Debug the `handleAIRuleGenerated` function flow
2. Check if the rule is being passed correctly to `handleSaveRule`
3. Verify the database save operation completes successfully
4. Ensure the rules list refreshes after saving

---
name: UX Improvement - Form Validation & Error Feedback
about: Replace alert() dialogs with proper inline validation and error components
title: '[UX] Replace alert() with inline form validation and error feedback'
labels: ['enhancement', 'ux', 'frontend', 'high-priority']
assignees: ''
---

## Problem Statement

The application currently uses browser `alert()` dialogs for form validation errors, which provides a poor user experience. Users cannot see errors in context, and there's no real-time validation feedback.

**Current Issues:**
- Browser `alert()` dialogs interrupt user workflow (found in `RuleEditor.tsx` lines 83, 88, 92)
- No inline field validation - errors only appear after form submission
- No clear indication of required vs optional fields
- Success messages disappear without user control
- No visual feedback during form interaction

**Impact:**
- Users make mistakes and don't understand what went wrong
- Poor user experience that feels outdated
- Users may lose work due to unclear error messages
- Accessibility issues (screen readers may not announce alerts properly)

## Proposed Solution

### 1. Create Reusable Error/Message Components
- **ErrorMessage component**: For inline field errors
- **SuccessMessage component**: Dismissible success notifications
- **FormField wrapper**: Handles validation state and error display

### 2. Replace alert() Calls
**Files to update:**
- `frontend/components/rule-builder/RuleEditor.tsx` (lines 83, 88, 92)
- Any other files using `alert()` or `confirm()`

**Before:**
```typescript
if (!description || !issueMessage) {
  alert("Please fill in both the Rule name and Issue Message fields.");
  return;
}
```

**After:**
```typescript
const [errors, setErrors] = useState<Record<string, string>>({});

// Real-time validation
useEffect(() => {
  const newErrors: Record<string, string> = {};
  if (!description) newErrors.description = "Rule name is required";
  if (!issueMessage) newErrors.issueMessage = "Issue message is required";
  setErrors(newErrors);
}, [description, issueMessage]);

// In JSX
<ErrorMessage error={errors.description} />
```

### 3. Add Real-time Validation
- Validate fields on blur/change
- Show inline error messages below fields
- Disable submit button when form is invalid
- Highlight invalid fields with red border

### 4. Improve Form Field Indicators
- Add required field asterisks (*)
- Add "Optional" labels where appropriate
- Show character counts for text inputs where relevant
- Add helpful placeholder text

### 5. Enhance Success Messages
- Make success messages dismissible
- Auto-hide after 5 seconds (with option to keep)
- Show success state in context (e.g., "Rule saved successfully" near the rule list)

## Implementation Plan

### Phase 1: Create Reusable Components
1. Create `ErrorMessage.tsx` component
2. Create `SuccessMessage.tsx` component  
3. Create `FormField.tsx` wrapper component
4. Add to component library/storybook if available

### Phase 2: Update RuleEditor
1. Replace alert() calls with error state
2. Add real-time validation
3. Add inline error messages
4. Test validation logic

### Phase 3: Update Other Forms
1. Update `CreateSurveyPage.tsx`
2. Update `SurveySettingsPage.tsx`
3. Search codebase for any remaining alert()/confirm() calls
4. Update all forms to use new components

### Phase 4: Polish
1. Add smooth transitions for error appearance
2. Add focus management (focus first error field)
3. Test with screen readers
4. Add unit tests for validation logic

## Acceptance Criteria

- [ ] No `alert()` or `confirm()` calls remain in the codebase
- [ ] All forms show inline error messages
- [ ] Real-time validation works on blur/change
- [ ] Required fields are clearly marked with asterisks
- [ ] Success messages are dismissible and auto-hide
- [ ] Error messages are accessible (proper ARIA labels)
- [ ] Form validation is consistent across all forms
- [ ] Invalid fields are visually highlighted
- [ ] Submit buttons are disabled when forms are invalid
- [ ] All changes are tested and work on mobile

## Files to Modify

- `frontend/components/rule-builder/RuleEditor.tsx`
- `frontend/pages/CreateSurveyPage.tsx`
- `frontend/pages/SurveySettingsPage.tsx`
- `frontend/components/ui/ErrorMessage.tsx` (new)
- `frontend/components/ui/SuccessMessage.tsx` (new)
- `frontend/components/ui/FormField.tsx` (new)

## Design Considerations

- Error messages should be in red/error color scheme
- Success messages should be in green/success color scheme
- Use consistent spacing and typography
- Ensure color contrast meets WCAG AA standards
- Error messages should be concise but helpful
- Consider internationalization if needed

## Testing Checklist

- [ ] Test validation on all form fields
- [ ] Test error message display/hiding
- [ ] Test success message dismissal
- [ ] Test keyboard navigation
- [ ] Test with screen reader
- [ ] Test on mobile devices
- [ ] Test form submission with invalid data
- [ ] Test form submission with valid data

## Related Issues

- Related to: Mobile responsiveness (forms need to work on mobile)
- Related to: Accessibility improvements (proper error announcements)

## References

- [WCAG 2.1 Error Identification](https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html)
- [WCAG 2.1 Error Suggestion](https://www.w3.org/WAI/WCAG21/Understanding/error-suggestion.html)
- UI/UX Review document: `UI_UX_REVIEW.md` (Issue #2)


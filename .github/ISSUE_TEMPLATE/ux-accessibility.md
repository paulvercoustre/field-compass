---
name: UX Improvement - Accessibility (WCAG Compliance)
about: Improve accessibility to meet WCAG 2.1 AA standards
title: '[UX] Improve accessibility - Add ARIA labels, keyboard navigation, and WCAG compliance'
labels: ['enhancement', 'ux', 'frontend', 'high-priority', 'accessibility']
assignees: ''
---

## Problem Statement

The Field Compass application has significant accessibility gaps that prevent users with disabilities from using the application effectively. The application does not meet WCAG 2.1 AA standards.

**Current Issues:**
- **Minimal ARIA labels**: Only 1 ARIA label found in entire codebase (`aria-label="Tabs"` in SubmissionDetail.tsx)
- **No keyboard navigation**: Complex components (modals, dropdowns, rule builder) not keyboard accessible
- **Color contrast**: May not meet WCAG AA standards (gray-400 on gray-800)
- **No focus indicators**: Many interactive elements lack visible focus states
- **Form labels**: Not all labels properly associated with inputs (`htmlFor`/`id` missing)
- **No skip links**: Keyboard users must tab through entire navigation
- **Screen reader support**: Limited semantic HTML and ARIA attributes
- **Error announcements**: Screen readers may not announce validation errors properly

**Impact:**
- **Legal risk**: May violate accessibility laws (ADA, Section 508, AODA)
- **User exclusion**: Users with disabilities cannot use the application
- **Poor UX**: Even users without disabilities benefit from better keyboard navigation
- **SEO impact**: Search engines rely on semantic HTML

## Proposed Solution

### 1. Comprehensive ARIA Labels and Roles

**Add ARIA labels to:**
- All buttons (especially icon-only buttons)
- Form inputs and fields
- Navigation elements
- Interactive components (modals, dropdowns, tabs)
- Status messages and alerts
- Complex widgets (rule builder, data tables)

**Example:**
```typescript
// Before
<button onClick={handleClick}>
  <DeleteIcon />
</button>

// After
<button 
  onClick={handleClick}
  aria-label="Delete survey"
  aria-describedby="delete-survey-help"
>
  <DeleteIcon aria-hidden="true" />
</button>
<span id="delete-survey-help" className="sr-only">
  Permanently delete this survey and all associated data
</span>
```

### 2. Keyboard Navigation Support

**Implement keyboard navigation for:**
- Modal dialogs (Tab, Shift+Tab, Escape to close, Enter to confirm)
- Dropdown menus (Arrow keys, Enter, Escape)
- Tabs (Arrow keys to navigate)
- Rule builder (Tab through conditions, Enter to add)
- Data tables (Arrow keys, Home, End)
- Sidebar navigation (Arrow keys)

**Example Modal:**
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && e.ctrlKey) onConfirm();
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

### 3. Focus Management

**Improvements:**
- Visible focus indicators on all interactive elements
- Focus trap in modals (focus stays within modal)
- Focus return after closing modals
- Focus on first error field after validation
- Skip links for main content

**CSS:**
```css
/* Ensure focus is visible */
*:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

/* Skip link */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: #000;
  color: #fff;
  padding: 8px;
  z-index: 100;
}
.skip-link:focus {
  top: 0;
}
```

### 4. Color Contrast Compliance

**Test and fix:**
- Text on background colors (minimum 4.5:1 for normal text, 3:1 for large text)
- Interactive element borders
- Error/success message colors
- Focus indicator colors

**Tools:**
- Use browser DevTools contrast checker
- Use online tools (WebAIM Contrast Checker)
- Test with color blindness simulators

### 5. Semantic HTML and Form Labels

**Fix form labels:**
```typescript
// Before
<label>Survey Name</label>
<input type="text" />

// After
<label htmlFor="survey-name">Survey Name *</label>
<input 
  id="survey-name"
  type="text"
  aria-required="true"
  aria-describedby="survey-name-error"
/>
<span id="survey-name-error" role="alert" aria-live="polite">
  {error}
</span>
```

### 6. Screen Reader Announcements

**Add live regions for:**
- Form validation errors
- Success messages
- Loading states
- Dynamic content updates

```typescript
<div 
  role="alert" 
  aria-live="polite" 
  aria-atomic="true"
  className="sr-only"
>
  {message}
</div>
```

### 7. Skip Links

**Add skip navigation:**
```typescript
<a href="#main-content" className="skip-link">
  Skip to main content
</a>
<main id="main-content" tabIndex={-1}>
  {/* Content */}
</main>
```

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Add skip links to main layout
2. Ensure all form labels use `htmlFor`/`id`
3. Add visible focus indicators (CSS)
4. Test color contrast and fix issues
5. Add `sr-only` utility class for screen reader text

### Phase 2: ARIA Labels (Week 1-2)
1. Audit all interactive elements
2. Add ARIA labels to buttons, icons, and controls
3. Add ARIA roles where needed (navigation, main, complementary, etc.)
4. Add ARIA descriptions for complex interactions
5. Test with screen reader (NVDA/JAWS/VoiceOver)

### Phase 3: Keyboard Navigation (Week 2)
1. Implement keyboard navigation for modals
2. Add keyboard support to dropdowns
3. Add keyboard support to tabs
4. Add keyboard support to rule builder
5. Test all keyboard interactions

### Phase 4: Advanced Features (Week 2-3)
1. Add focus management (traps, returns)
2. Implement live regions for dynamic content
3. Add proper error announcements
4. Test with multiple screen readers
5. Document keyboard shortcuts

### Phase 5: Testing & Validation (Week 3)
1. Automated testing with axe-core
2. Manual testing with screen readers
3. Keyboard-only testing
4. Color contrast validation
5. WCAG 2.1 AA compliance audit

## Acceptance Criteria

- [ ] All interactive elements have ARIA labels or accessible names
- [ ] All forms have properly associated labels
- [ ] Keyboard navigation works for all features
- [ ] Focus indicators are visible on all interactive elements
- [ ] Color contrast meets WCAG AA standards (4.5:1 for text)
- [ ] Screen readers can navigate and use all features
- [ ] Skip links are implemented
- [ ] Modals are keyboard accessible (focus trap, Escape to close)
- [ ] Error messages are announced to screen readers
- [ ] No accessibility violations in automated testing (axe-core)
- [ ] Tested with at least one screen reader (NVDA, JAWS, or VoiceOver)

## Files to Modify

### Core Components
- `frontend/App.tsx` - Add skip links, ARIA landmarks
- `frontend/components/Sidebar.tsx` - Add ARIA labels, keyboard nav
- `frontend/components/Dashboard.tsx` - Add ARIA labels

### Forms
- `frontend/pages/CreateSurveyPage.tsx` - Fix labels, add ARIA
- `frontend/pages/SurveySettingsPage.tsx` - Fix labels, add ARIA
- `frontend/components/rule-builder/RuleEditor.tsx` - Keyboard nav, ARIA
- `frontend/components/rule-builder/ConditionRow.tsx` - ARIA labels

### Interactive Components
- `frontend/components/SubmissionList.tsx` - ARIA labels, keyboard nav
- `frontend/components/SubmissionDetail.tsx` - ARIA labels, keyboard nav
- `frontend/components/ui/Modal.tsx` (new) - Focus trap, keyboard nav
- `frontend/components/ui/Dropdown.tsx` (if exists) - Keyboard nav

### Utilities
- `frontend/utils/accessibility.ts` (new) - Helper functions
- `frontend/styles/accessibility.css` (new) - Focus styles, skip links

## Testing Checklist

### Automated Testing
- [ ] Run axe-core on all pages
- [ ] Fix all critical and serious violations
- [ ] Run Lighthouse accessibility audit
- [ ] Target 90+ accessibility score

### Screen Reader Testing
- [ ] Test with NVDA (Windows)
- [ ] Test with JAWS (Windows)
- [ ] Test with VoiceOver (macOS/iOS)
- [ ] Test with TalkBack (Android)
- [ ] Verify all content is announced correctly
- [ ] Verify navigation works
- [ ] Verify forms are usable

### Keyboard Testing
- [ ] Tab through entire application
- [ ] Test all interactive elements
- [ ] Test modals (focus trap, Escape)
- [ ] Test dropdowns (Arrow keys, Enter)
- [ ] Test tabs (Arrow keys)
- [ ] Verify no keyboard traps

### Visual Testing
- [ ] Test with browser zoom (200%)
- [ ] Test color contrast ratios
- [ ] Test with color blindness simulators
- [ ] Verify focus indicators are visible
- [ ] Test in high contrast mode

## Tools and Resources

### Testing Tools
- **axe DevTools**: Browser extension for accessibility testing
- **WAVE**: Web accessibility evaluation tool
- **Lighthouse**: Built into Chrome DevTools
- **Color Contrast Analyzer**: For checking contrast ratios

### Screen Readers
- **NVDA**: Free, Windows
- **JAWS**: Commercial, Windows
- **VoiceOver**: Built into macOS/iOS
- **TalkBack**: Built into Android

### Documentation
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Accessibility Resources](https://webaim.org/resources/)

## Design Considerations

### Focus Indicators
- Use 2px solid outline
- Use brand color (indigo-600)
- Ensure sufficient contrast
- Add offset for better visibility

### Screen Reader Text
- Use `.sr-only` class (visually hidden but accessible)
- Provide context for icon-only buttons
- Describe complex interactions
- Announce dynamic content changes

### Color Usage
- Don't rely on color alone to convey information
- Use icons, text, or patterns in addition to color
- Ensure sufficient contrast for all text
- Test with color blindness simulators

## Related Issues

- Blocks: Users with disabilities cannot use the application
- Related to: Form validation (errors must be announced)
- Related to: Mobile responsiveness (mobile accessibility)

## References

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)
- UI/UX Review document: `UI_UX_REVIEW.md` (Issue #4)

## Legal Considerations

- **ADA (Americans with Disabilities Act)**: May apply to web applications
- **Section 508**: Required for US federal agencies
- **AODA (Accessibility for Ontarians with Disabilities Act)**: Required in Ontario
- **EN 301 549**: European accessibility standard

Meeting WCAG 2.1 AA standards helps ensure compliance with these regulations.



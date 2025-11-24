# UI Theme Migration Prompt for LLM Agent

## Objective
Convert the Field Compass application UI from a hardcoded dark theme to a light theme by default, while preserving dark mode rendering when the user's system is in dark mode. This requires updating all components, pages, and UI blocks throughout the application to use Tailwind CSS's dark mode feature.

## Context
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS (via CDN in `index.html`)
- **Current State**: All components use hardcoded dark theme classes (e.g., `bg-gray-900`, `bg-gray-800`, `text-gray-300`, `border-gray-700`)
- **Target State**: Light theme by default with automatic dark mode support via system preference

## Technical Requirements

### 1. Enable Tailwind Dark Mode
- Update `index.html` to enable Tailwind's dark mode using the `media` strategy (respects system preference)
- Modify the Tailwind config script in `index.html` to include:
  ```javascript
  tailwind.config = {
    darkMode: 'media',
    theme: {
      extend: {
        colors: {
          gray: {
            850: '#182032',
          }
        }
      }
    }
  }
  ```
- Remove hardcoded `bg-gray-900` class from the `<html>` tag in `index.html` (or change to light background)

### 2. Color Mapping Strategy
Replace all hardcoded dark theme classes with light theme equivalents that automatically switch to dark mode:

**Background Colors:**
- `bg-gray-900` → `bg-white dark:bg-gray-900`
- `bg-gray-800` → `bg-gray-50 dark:bg-gray-800` or `bg-white dark:bg-gray-800`
- `bg-gray-850` → `bg-gray-100 dark:bg-gray-850` (custom color)
- `bg-gray-700` → `bg-gray-200 dark:bg-gray-700`
- `bg-gray-800/50` → `bg-gray-50/50 dark:bg-gray-800/50`

**Text Colors:**
- `text-white` → `text-gray-900 dark:text-white`
- `text-gray-300` → `text-gray-700 dark:text-gray-300`
- `text-gray-400` → `text-gray-600 dark:text-gray-400`
- `text-gray-500` → `text-gray-500 dark:text-gray-500` (usually stays the same)
- `text-gray-200` → `text-gray-800 dark:text-gray-200`

**Border Colors:**
- `border-gray-700` → `border-gray-300 dark:border-gray-700`
- `border-gray-800` → `border-gray-200 dark:border-gray-800`

**Hover States:**
- `hover:bg-gray-700` → `hover:bg-gray-100 dark:hover:bg-gray-700`
- `hover:text-white` → `hover:text-gray-900 dark:hover:text-white`
- `hover:text-gray-200` → `hover:text-gray-800 dark:hover:text-gray-200`
- `hover:border-gray-500` → `hover:border-gray-400 dark:hover:border-gray-500`

**Special Cases:**
- Badge colors: Update status badge backgrounds (e.g., `bg-blue-800` → `bg-blue-100 dark:bg-blue-800`, `text-blue-200` → `text-blue-800 dark:text-blue-200`)
- Quality issue cards: `bg-yellow-900/50` → `bg-yellow-50 dark:bg-yellow-900/50`, `border-yellow-700/50` → `border-yellow-200 dark:border-yellow-700/50`
- Error messages: `bg-red-900/50` → `bg-red-50 dark:bg-red-900/50`, `text-red-200` → `text-red-800 dark:text-red-200`
- Success messages: `text-green-400` → `text-green-600 dark:text-green-400`

### 3. Files to Update

Update ALL of the following files systematically:

**Core Application:**
- `index.html` - Enable dark mode, update root element
- `frontend/App.tsx` - Main app container, navigation buttons, header

**Components:**
- `frontend/components/Sidebar.tsx` - Sidebar background, borders, text
- `frontend/components/Dashboard.tsx` - Dashboard layout, filters panel
- `frontend/components/SubmissionList.tsx` - List container, headers
- `frontend/components/SubmissionListItem.tsx` - List item backgrounds, hover states
- `frontend/components/SubmissionDetail.tsx` - Detail panel, metadata cards, tabs, quality issue cards
- `frontend/components/SubmissionFilters.tsx` - Filter panel, form elements
- `frontend/components/Badge.tsx` - Status badge colors
- `frontend/components/JsonViewer.tsx` - JSON viewer background and text
- `frontend/components/HistoryViewer.tsx` - History viewer styling
- `frontend/components/Spinner.tsx` - Spinner colors (if applicable)
- `frontend/components/SurveySelector.tsx` - Selector dropdown styling

**UI Components:**
- `frontend/components/ui/ErrorMessage.tsx` - Error message styling
- `frontend/components/ui/SuccessMessage.tsx` - Success message styling
- `frontend/components/ui/FormField.tsx` - Form field styling
- `frontend/components/ui/SubTabButton.tsx` - Tab button styling

**Pages:**
- `frontend/pages/CreateSurveyPage.tsx` - Form sections, inputs, buttons
- `frontend/pages/DataCollectionProgressPage.tsx` - Progress page styling
- `frontend/pages/EnumeratorPerformancePage.tsx` - Performance page styling
- `frontend/pages/ProgressTracker.tsx` - Progress tracker styling
- `frontend/pages/SurveySettingsPage.tsx` - Settings page styling
- `frontend/pages/SurveySetupPage.tsx` - Setup page styling
- `frontend/pages/RuleBuilder.tsx` - Rule builder styling

**Progress Tracker Components:**
- `frontend/components/progress-tracker/ProgressBar.tsx`
- `frontend/components/progress-tracker/ProgressDataView.tsx`
- `frontend/components/progress-tracker/PerformanceDataView.tsx`
- `frontend/components/progress-tracker/InfoModal.tsx`

**Rule Builder Components:**
- `frontend/components/rule-builder/RuleEditor.tsx`
- `frontend/components/rule-builder/ConditionRow.tsx`
- `frontend/components/rule-builder/GlobalParameters.tsx`
- `frontend/components/rule-builder/StagedRulesList.tsx`

### 4. Specific Component Patterns

**Navigation Buttons:**
- Active: `bg-indigo-600 text-white` → Keep as is (indigo works in both themes)
- Inactive: `text-gray-300 hover:bg-gray-700 hover:text-white` → `text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white`

**Form Inputs:**
- `bg-gray-800 border border-gray-700` → `bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700`
- `text-white` → `text-gray-900 dark:text-white`
- Focus rings: Keep `focus:ring-indigo-500` (works in both themes)

**Cards/Panels:**
- `bg-gray-900/50` → `bg-gray-50 dark:bg-gray-900/50`
- `bg-gray-800/50` → `bg-white dark:bg-gray-800/50`
- Borders: `border-gray-700` → `border-gray-200 dark:border-gray-700`

**Buttons:**
- Primary buttons (indigo): Keep as is - `bg-indigo-600 text-white hover:bg-indigo-700`
- Disabled: `disabled:bg-gray-600` → `disabled:bg-gray-300 dark:disabled:bg-gray-600`

**Tabs:**
- Active tab: `border-indigo-400 text-indigo-400` → Keep as is
- Inactive: `text-gray-400 hover:text-gray-200 hover:border-gray-500` → `text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500`

### 5. Quality Assurance Checklist

After making changes, verify:
- [ ] All pages render correctly in light mode
- [ ] All pages automatically switch to dark mode when system preference is dark
- [ ] All interactive elements (buttons, links, inputs) have proper hover states in both themes
- [ ] All borders and dividers are visible in both themes
- [ ] Text contrast meets accessibility standards in both themes
- [ ] Badges and status indicators are readable in both themes
- [ ] Form inputs are clearly visible and usable in both themes
- [ ] No hardcoded dark-only classes remain (except within `dark:` variants)
- [ ] The root HTML element doesn't force a dark background

### 6. Implementation Strategy

1. **Start with configuration**: Update `index.html` to enable dark mode
2. **Work top-down**: Begin with `App.tsx`, then move to pages, then components
3. **Be systematic**: For each file, search for all instances of dark theme classes and replace them
4. **Test incrementally**: After updating each major component, verify it works in both themes
5. **Handle edge cases**: Pay special attention to:
   - Opacity modifiers (`/50`, `/30`, etc.)
   - Custom colors (like `gray-850`)
   - Nested components that might inherit styles
   - SVG icons that might need color adjustments

### 7. Important Notes

- **Do NOT** remove the `dark:` prefix classes - these are essential for dark mode support
- **Do NOT** change indigo/blue accent colors unless they cause visibility issues
- **Preserve** all existing functionality and layout - only change colors
- **Maintain** semantic meaning of colors (e.g., red for errors, green for success)
- **Ensure** sufficient contrast ratios for accessibility (WCAG AA minimum)

### 8. Example Transformation

**Before:**
```tsx
<div className="bg-gray-900 text-gray-300 border border-gray-700">
  <h2 className="text-white">Title</h2>
  <p className="text-gray-400">Description</p>
</div>
```

**After:**
```tsx
<div className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700">
  <h2 className="text-gray-900 dark:text-white">Title</h2>
  <p className="text-gray-600 dark:text-gray-400">Description</p>
</div>
```

## Execution Instructions

1. Read and understand the current codebase structure
2. Update `index.html` first to enable dark mode
3. Systematically go through each file listed in section 3
4. For each file, replace all dark theme classes with light theme + dark mode variants
5. Test that the application renders correctly in both light and dark modes
6. Ensure no visual regressions or broken layouts
7. Verify all interactive elements work correctly in both themes

## Success Criteria

- ✅ Application displays in light theme by default
- ✅ Application automatically switches to dark theme when system preference is dark
- ✅ All pages and components are updated consistently
- ✅ No hardcoded dark-only styling remains
- ✅ All UI elements are visible and accessible in both themes
- ✅ Interactive elements have proper hover/focus states in both themes


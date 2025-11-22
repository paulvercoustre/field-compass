# Enhanced Filtering System for QA Dashboard

## Problem Statement

Currently, users can filter submissions in the QA Dashboard by validation status (Triage, All, Pending Approval, Approved, Rejected) using client-side filtering. However, users need the ability to filter submissions by additional criteria:

- **Enumerator**: Filter submissions by the enumerator who collected them
- **Sampling Variables**: Filter by sampling frame variables (e.g., district, livelihood, etc.)

This would allow QA staff to:
- Review all submissions from a specific enumerator
- Focus on submissions from specific geographic areas or demographic groups
- Combine multiple filter criteria for more targeted review

## Current State

- ✅ Client-side filtering by QA status (working)
- ✅ Backend API supports filtering by enumerator and sampling variables (implemented in `backend/routers/submissions.py`)
- ❌ Frontend UI does not expose these filtering options
- ❌ No way to combine multiple filter criteria

## Proposed Solution

### UI Design

Add a filtering panel above the submission list in the QA Dashboard with:

1. **QA Status Filter** (dropdown)
   - All Statuses (default)
   - Flagged
   - Pending Approval
   - Approved
   - Rejected

2. **Enumerator Filter** (dropdown, conditional)
   - Only shown if enumerator field is configured in survey
   - Populated with unique enumerator values from submissions
   - "All Enumerators" option

3. **Sampling Variable Filter** (two dropdowns, conditional)
   - First dropdown: Select sampling variable (e.g., "district", "livelihood")
   - Second dropdown: Select value for that variable
   - Only shown if sampling variables are configured in survey
   - Value dropdown populated based on selected variable

4. **Clear Filters** button
   - Resets all filters to default state

### Technical Implementation

#### Frontend Changes

1. **Create `SubmissionFilters` component**
   - Extract unique enumerator values from submissions
   - Extract unique sampling variable values dynamically
   - Handle filter state management
   - Call API with filter parameters

2. **Update `Dashboard` component**
   - Integrate `SubmissionFilters` component
   - Fetch all submissions initially (for filter options)
   - Fetch filtered submissions when filters change
   - Handle loading states

3. **Update `api.ts` service**
   - Modify `getSubmissions` to accept filter object
   - Support new filter parameters: `enumerator`, `samplingVariable`, `samplingValue`

4. **Update `SubmissionList` component**
   - Remove client-side status filtering (move to server-side)
   - Display filtered results from API

#### Backend (Already Implemented)

The backend API in `backend/routers/submissions.py` already supports:
- `enumerator` parameter: Filter by enumerator ID/value
- `sampling_variable` parameter: Filter by sampling variable name
- `sampling_value` parameter: Filter by sampling variable value

**Note**: Backend filtering requires `survey_id` to determine field names from survey configuration.

### Implementation Considerations

1. **Performance**
   - Filter options should be extracted from all submissions (not just filtered ones)
   - Consider caching filter options
   - Server-side filtering is more efficient than client-side for large datasets

2. **User Experience**
   - Filters should persist when switching between submissions
   - Clear visual indication of active filters
   - Show count of filtered results
   - Handle empty states gracefully

3. **Data Extraction**
   - Enumerator and sampling variable values need to be extracted from `submission_data` JSONB
   - Handle path-based field names (e.g., `module/enumerator_id`)
   - Handle missing or null values

4. **Error Handling**
   - Handle cases where survey config is missing
   - Handle cases where no submissions exist
   - Handle API errors gracefully

## Acceptance Criteria

- [ ] Users can filter submissions by QA status via dropdown
- [ ] Users can filter submissions by enumerator (if configured in survey)
- [ ] Users can filter submissions by sampling variable and value (if configured in survey)
- [ ] Multiple filters can be combined (AND logic)
- [ ] Filter options are populated from actual submission data
- [ ] Filtering happens server-side for performance
- [ ] Active filters are clearly indicated in UI
- [ ] "Clear Filters" button resets all filters
- [ ] Filter state persists when viewing submission details
- [ ] Empty states are handled gracefully
- [ ] Loading states are shown during filter operations

## Technical Notes

### Field Name Resolution

The system needs to handle Kobo's path-based field names:
- Config may specify: `enumerator_id`
- Kobo stores as: `sampling_information/enumerator_id`
- Backend already handles this via `_get_field_value_from_jsonb()` function

### Survey Configuration Requirements

- Enumerator field: `config.core_identifiers.enumerator`
- Sampling variables: `config.sampling_frame.sampling_cols`

### API Endpoint

```
GET /api/submissions?survey_id={uuid}&qa_status={status}&enumerator={value}&sampling_variable={name}&sampling_value={value}
```

## Related Work

- Backend filtering support: Already implemented in `backend/routers/submissions.py`
- Previous attempt: Rolled back due to infinite re-render issues (see commit history)

## Priority

**Medium** - Improves QA workflow efficiency but not blocking core functionality

## Estimated Effort

**2-3 days** - Includes UI implementation, testing, and bug fixes

## Labels

`enhancement`, `frontend`, `qa-dashboard`, `filtering`


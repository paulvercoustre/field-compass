# Survey Management UX Improvements

## Current Issues

1. **Survey creation/edit flow is confusing**
   - Same page handles both creation and editing
   - No clear separation between viewing and editing
   - Hard to understand current state (new vs existing)

2. **Rule builder is separate**
   - Rules are created in a separate page
   - Not integrated with survey setup
   - Rules need to be saved separately

## Proposed Solution (Inspired by KoboToolbox)

### 1. Survey List/Management Page

**Purpose**: Overview of all surveys with management actions

**Features**:
- Table or card grid view showing:
  - Survey name
  - Kobo Asset ID
  - Submission count
  - Last updated date
  - Status indicators
- Actions per survey:
  - **View/Edit**: Open survey configuration
  - **Delete**: Remove survey (with confirmation)
  - **Duplicate**: Clone survey with new name
  - **Run ETL**: Trigger ETL pipeline for this survey
- Search/filter bar
- "Create New Survey" button (prominent, top-right)

**Layout**:
```
┌─────────────────────────────────────────┐
│  Surveys                    [+ New]     │
├─────────────────────────────────────────┤
│  [Search...]                            │
├─────────────────────────────────────────┤
│  Survey Name    | Asset ID | Submissions│
│  ─────────────────────────────────────  │
│  Test Survey    | abc123   | 7          │
│    [Edit] [Delete] [Duplicate] [Run ETL]│
│  ─────────────────────────────────────  │
│  Survey 2       | xyz789   | 0          │
│    [Edit] [Delete] [Duplicate] [Run ETL]│
└─────────────────────────────────────────┘
```

### 2. Survey Creation/Edit Wizard

**Purpose**: Step-by-step survey configuration

**Structure**: Multi-step form with progress indicator

**Steps**:

1. **Basic Information**
   - Survey name
   - Kobo Asset ID
   - Description (optional)

2. **Kobo Tool Upload**
   - Upload XLSX file
   - Parse and validate
   - Show variable count

3. **Core Configuration**
   - Core Identifiers (dropdowns from tool)
   - Special Values (DK values)
   - Global Parameters (dates, duration limits)

4. **Sampling Frame**
   - Upload CSV
   - Validate against tool
   - Preview data
   - Configure columns

5. **Data Quality Rules** ⭐ NEW
   - Integrated rule builder
   - List of existing rules
   - Add/Edit/Delete rules
   - Test rules against sample data
   - Rule templates/quick add

6. **Review & Save**
   - Summary of all settings
   - Validation check
   - Save button

**Navigation**:
- Progress bar at top showing current step
- Previous/Next buttons
- Save draft (optional)
- Cancel with confirmation

### 3. Integration Points

**Rule Builder Integration**:
- Embed rule editor component in Step 5
- Rules saved directly to `validation_rules` table
- Link rules to survey via `survey_id`
- Show rule status (active/inactive)
- Preview rule logic

**API Endpoints Needed**:
- `GET /api/surveys` - List all (already exists)
- `GET /api/surveys/{id}` - Get one (already exists)
- `POST /api/surveys` - Create (already exists)
- `PUT /api/surveys/{id}` - Update (already exists)
- `DELETE /api/surveys/{id}` - Delete (needs to be added)
- `POST /api/surveys/{id}/duplicate` - Duplicate (needs to be added)
- `GET /api/surveys/{id}/rules` - Get rules for survey (needs to be added)
- `POST /api/surveys/{id}/rules` - Create rule (needs to be added)
- `PUT /api/surveys/{id}/rules/{rule_id}` - Update rule (needs to be added)
- `DELETE /api/surveys/{id}/rules/{rule_id}` - Delete rule (needs to be added)

## Implementation Plan

### Phase 1: Survey List Page
1. Create `SurveyListPage.tsx`
2. Add delete endpoint to backend
3. Add duplicate endpoint to backend
4. Create survey card/table component
5. Add search/filter functionality

### Phase 2: Survey Wizard
1. Create `SurveyWizard.tsx` component
2. Break current form into steps
3. Add step navigation
4. Add progress indicator
5. Add draft saving (optional)

### Phase 3: Rule Builder Integration
1. Extract rule builder components
2. Integrate into Step 5 of wizard
3. Connect to validation_rules API
4. Add rule management (CRUD)
5. Add rule testing/preview

### Phase 4: Polish
1. Add loading states
2. Add error handling
3. Add confirmation dialogs
4. Add success messages
5. Add validation

## Benefits

1. **Clearer UX**: Users understand they're creating vs editing
2. **Better Organization**: All survey management in one place
3. **Integrated Workflow**: Rules created during survey setup
4. **Familiar Pattern**: Similar to KoboToolbox (users may already know it)
5. **Scalability**: Easy to add more steps/features later



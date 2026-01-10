# Issue #9: Feature: Data Quality Issues Overview Dashboard

**Repository:** [paulvercoustre/field-compass](https://github.com/paulvercoustre/field-compass)  
**Issue Number:** #9  
**Status:** Open / Ready for Implementation  
**Type:** Feature Request  
**Priority:** Medium

---

## Issue Description

This issue tracks the implementation of a comprehensive Data Quality Issues Overview Dashboard that provides a high-level, aggregated view of data quality for the selected survey. The dashboard will help users identify common quality problems, track quality trends over time, and prioritize review efforts.

---

## Key Design Decisions (Confirmed)

| Decision | Value |
|----------|-------|
| **Default survey scope** | Selected survey only (not cross-survey) |
| **Default date range** | All time (no date filter applied) |
| **Issue frequency default** | Top 5 issues |
| **Enumerator stats** | Separate page (Enumerator Performance) with cross-links |
| **Chart library** | `recharts` (already installed) |

---

## Feature Specification: Data Quality Issues Overview Dashboard

### 1. Overview

#### 1.1 Purpose
The Data Quality Issues Overview Dashboard provides a high-level, aggregated view of data quality for the currently selected survey. It helps users identify common quality problems, track quality trends over time, and prioritize review efforts.

#### 1.2 Goals
- **Identify Patterns:** Quickly spot which quality checks are failing most frequently
- **Track Trends:** Monitor if data quality is improving or deteriorating over time
- **Focus Effort:** Highlight specific issues that need immediate attention
- **Monitor Health:** Provide submission status breakdown and issue metrics

#### 1.3 Target Users
- QA Managers
- Field Supervisors
- Data Analysts
- Survey Coordinators

#### 1.4 Relationship to Enumerator Performance Page
This dashboard focuses on **aggregate quality patterns and trends**. For per-enumerator quality breakdown, users should navigate to the **Enumerator Performance** page. Cross-links between the two pages will be provided for easy navigation.

---

## 2. User Stories

### Primary User Stories
1. **As a QA Manager**, I want to see the most common quality issues so I can prioritize training materials for enumerators.
2. **As a Field Supervisor**, I want to see quality trends over time to assess if recent feedback has improved performance.
3. **As a Survey Coordinator**, I want to see overall quality health metrics to report to stakeholders.
4. **As a QA Reviewer**, I want to click on an issue type to see all affected submissions.
5. **As a Data Analyst**, I want to filter quality data by date range, enumerator, or sampling variables to analyze specific subsets.

### Secondary User Stories
6. Export quality metrics for reporting
7. Compare quality metrics across different time periods
8. Track specific issue types over time
9. Get alerts when quality drops below thresholds (future enhancement)

---

## 3. Data Requirements

### 3.1 Data Sources
- `submissions_current` table:
  - `data_quality_issues` (JSONB array of quality issues)
  - `qa_status` (PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED)
  - `_submission_time` (for temporal analysis)
  - `submission_data` (for enumerator ID, sampling variables)
  - `is_edited` (for edit analysis)
- `survey_configs` table:
  - `config_data` (for enumerator field name, sampling columns)

### 3.2 Aggregations Needed

#### Issue Frequency Metrics
- Count of each issue type (by `check` field)
- Percentage of submissions affected by each issue type
- Total unique issue types
- Total submissions with issues vs. without

#### Temporal Metrics
- Issue counts by day/week/month
- Issue trends (increasing/decreasing)
- Quality status distribution over time
- Submission volume over time
- Issue-specific counts over time (for selected issue types)

#### Quality Health Metrics
- Overall quality score (% approved)
- Average issues per submission
- Submissions needing review count
- Quality trend (improving/declining/stable)

---

## 4. API Specification

### 4.1 New Endpoint: `/api/quality/overview`

**Endpoint:** `GET /api/quality/overview`

**Query Parameters:**
- `survey_id` (**required**, UUID): Filter by survey ID - the dashboard always shows data for one survey
- `start_date` (optional, ISO date string): Start of date range (YYYY-MM-DD). Default: no filter (all time)
- `end_date` (optional, ISO date string): End of date range (YYYY-MM-DD). Default: no filter (all time)
- `enumerator` (optional, string): Filter by enumerator ID. Default: all enumerators
- `sampling_filters` (optional, string): Filter by sampling variables (same format as submissions endpoint: `variable1=value1,value2;variable2=value3`). Default: all

**Response Model:**

```python
class IssueFrequency(BaseModel):
    check: str  # Issue type (e.g., "duration_too_short", "outlier_age")
    count: int  # Number of occurrences
    percentage: float  # Percentage of total submissions affected
    affected_submissions: int  # Number of unique submissions affected

class TemporalDataPoint(BaseModel):
    date: str  # ISO date string (YYYY-MM-DD)
    total_submissions: int  # Submissions on this date
    approved_count: int
    pending_count: int
    flagged_count: int
    rejected_count: int
    total_issues: int  # Total issues found on this date

class IssueTimeSeriesPoint(BaseModel):
    date: str  # ISO date string (YYYY-MM-DD)
    issue_counts: Dict[str, int]  # Map of check -> count for this date

class SubmissionStatusSummary(BaseModel):
    total_submissions: int
    approved_count: int
    approved_percentage: float
    pending_count: int
    pending_percentage: float
    flagged_count: int
    flagged_percentage: float
    rejected_count: int
    rejected_percentage: float

class QualityMetricsSummary(BaseModel):
    total_issues: int  # Total count of all issues
    submissions_with_issues: int  # Number of submissions that have at least one issue
    avg_issues_per_submission: float  # total_issues / total_submissions

class QualityOverviewResponse(BaseModel):
    # Submission status breakdown
    status_summary: SubmissionStatusSummary
    
    # Quality metrics
    quality_metrics: QualityMetricsSummary
    
    # Issue frequency (sorted by count descending)
    issue_frequency: List[IssueFrequency]
    
    # Temporal data (daily aggregation) - submission status over time
    temporal_data: List[TemporalDataPoint]
    
    # Issue-specific time series
    issue_time_series: List[IssueTimeSeriesPoint]
    
    # Date range of data (actual min/max dates in the dataset)
    date_range: Dict[str, str]  # {"start": "2024-01-01", "end": "2024-01-31"}
```

**Example Response:**
```json
{
  "status_summary": {
    "total_submissions": 1250,
    "approved_count": 850,
    "approved_percentage": 68.0,
    "pending_count": 100,
    "pending_percentage": 8.0,
    "flagged_count": 280,
    "flagged_percentage": 22.4,
    "rejected_count": 20,
    "rejected_percentage": 1.6
  },
  "quality_metrics": {
    "total_issues": 562,
    "submissions_with_issues": 320,
    "avg_issues_per_submission": 0.45
  },
  "issue_frequency": [
    {
      "check": "duration_too_short",
      "count": 145,
      "percentage": 11.6,
      "affected_submissions": 145
    },
    {
      "check": "outlier_age",
      "count": 89,
      "percentage": 7.1,
      "affected_submissions": 89
    }
  ],
  "temporal_data": [
    {
      "date": "2024-01-15",
      "total_submissions": 50,
      "approved_count": 30,
      "pending_count": 5,
      "flagged_count": 15,
      "rejected_count": 0,
      "total_issues": 45
    }
  ],
  "issue_time_series": [
    {
      "date": "2024-01-15",
      "issue_counts": {
        "duration_too_short": 12,
        "outlier_age": 8,
        "date_out_of_range": 5
      }
    }
  ],
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  }
}
```

### 4.2 Implementation Notes
- Use PostgreSQL JSONB functions (`jsonb_array_elements`, `jsonb_extract_path_text`) for aggregations
- Leverage existing GIN index on `data_quality_issues` column
- Cache results for 5 minutes to reduce database load
- `survey_id` is required - the dashboard always operates on a single survey
- When no date filters are provided, return all time data
- Issue frequency is returned sorted by count (descending) - frontend handles top N display
- Consider materialized view for performance if data volume is very large

---

## 5. UI/UX Design Specification

### 5.1 Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Data Quality Overview                                         [Refresh]│
├─────────────────────────────────────────────────────────────────────────┤
│  Filters: [Date Range: All ▼] [Enumerator: All ▼] [Sampling Vars ▼]    │
│           [View Enumerator Breakdown →]                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SUBMISSION STATUS                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Total    │ │ Approved │ │ Pending  │ │ Flagged  │ │ Rejected │       │
│  │ 1,250    │ │ 850      │ │ 100      │ │ 280      │ │ 20       │       │
│  │          │ │ (68%)    │ │ (8%)     │ │ (22%)    │ │ (2%)     │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                                          │
│  QUALITY METRICS                                                         │
│  ┌──────────────────────┐ ┌────────────────────────┐                    │
│  │ Total Issues         │ │ Avg Issues/Submission  │                    │
│  │ 562                  │ │ 0.45                   │                    │
│  │ across 320 subms     │ │                        │                    │
│  └──────────────────────┘ └────────────────────────┘                    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Issue Frequency                               [Top 5 ▼] [Show All]│   │
│  │ ┌────────────────────────────────────────────────────────────┐   │   │
│  │ │ duration_too_short          ████████████████ 145 (11.6%)   │   │   │
│  │ │ outlier_age                 ██████████ 89 (7.1%)           │   │   │
│  │ │ date_out_of_range           ████████ 67 (5.4%)             │   │   │
│  │ │ interview_on_weekend        █████ 45 (3.6%)                │   │   │
│  │ │ missing_required_field      ████ 32 (2.6%)                 │   │   │
│  │ └────────────────────────────────────────────────────────────┘   │   │
│  │ Click on a bar to filter submissions by that issue type          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────────┐ ┌────────────────────────────┐          │
│  │ Submission Status Over Time │ │ Issues Over Time           │          │
│  │ [Line Chart]                │ │ [Line Chart]                │          │
│  │                             │ │ [Filter: Top 5 Issues ▼]    │          │
│  │  ── Total Submissions       │ │  ── duration_too_short      │          │
│  │  ── Approved                │ │  ── outlier_age             │          │
│  │  ── Flagged                 │ │  ── date_out_of_range       │          │
│  │  ── Pending                 │ │                             │          │
│  └────────────────────────────┘ └────────────────────────────┘          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component Breakdown

#### 5.2.1 Summary Cards - Submission Status (Top Row)
Five cards showing submission counts by QA status:

- **Total Submissions Card**
  - Total count of all submissions for the selected survey
  - No percentage shown
  
- **Approved Card**
  - Count of submissions with `qa_status = APPROVED`
  - Percentage of total shown below
  - Clickable: Links to filtered submission list (status=APPROVED)
  
- **Pending Approval Card**
  - Count of submissions with `qa_status = PENDING_APPROVAL`
  - Percentage of total shown below
  - Clickable: Links to filtered submission list (status=PENDING_APPROVAL)
  
- **Flagged Card**
  - Count of submissions with `qa_status = FLAGGED`
  - Percentage of total shown below
  - Clickable: Links to filtered submission list (status=FLAGGED)
  
- **Rejected Card**
  - Count of submissions with `qa_status = REJECTED`
  - Percentage of total shown below
  - Clickable: Links to filtered submission list (status=REJECTED)

#### 5.2.2 Summary Cards - Quality Metrics (Second Row)
Two cards showing quality issue metrics:

- **Total Issues Card**
  - Total count of all quality issues across all submissions
  - Subtitle: "across X submissions" (number of submissions that have at least one issue)
  
- **Average Issues per Submission Card**
  - Average number of issues per submission
  - Calculated as: total_issues / total_submissions
  - Tooltip: Explanation of calculation

#### 5.2.2 Issue Frequency Chart
- **Type:** Horizontal bar chart
- **X-axis:** Count of issues
- **Y-axis:** Issue types (sorted by frequency, descending)
- **Interactive:** Click bar to filter submissions by issue type
- **Display:** Count and percentage for each issue
- **Default:** Show top 5 issues
- **Controls:**
  - Dropdown to select "Top 5", "Top 10", "Top 20", or "All"
  - Multi-select filter to show specific issue types
  - "Show All" button to display all issues

#### 5.2.3 Quality Trends Over Time
- **Type:** Multi-line chart
- **X-axis:** Date (daily aggregation, or weekly/monthly based on date range)
- **Y-axis:** Count
- **Lines:**
  - Total issues per day
  - Flagged submissions per day
  - Approved submissions per day
- **Interactive:** Hover for exact values, click to drill down
- **Time Range Selector:** Last 7/30/90 days, custom range

#### 5.2.4 Issues Over Time (Issue-Specific)
- **Type:** Multi-line chart
- **X-axis:** Date (daily aggregation, or weekly/monthly based on date range)
- **Y-axis:** Count of issues
- **Lines:** One line per selected issue type
- **Filter:** Multi-select dropdown to choose which issue types to display
- **Default:** Show all issue types (or top 5 if too many)
- **Interactive:** 
  - Hover for exact values
  - Click line to filter submissions by that issue type
  - Toggle visibility of individual issue types
- **Use Case:** Track how specific issue types are trending over time

### 5.3 Filters and Controls

#### 5.3.1 Global Filters (Applied to All Data)
- **Survey:** Uses the currently selected survey from `SurveyContext` (no selector on this page)
  - Dashboard requires a survey to be selected
  - If no survey selected, show prompt to select one from sidebar
- **Date Range Picker:** 
  - **Presets:** All Time, Last 7 days, Last 30 days, Last 90 days, This month, Custom
  - **Default:** All Time (no date filter)
- **Enumerator Filter:** Multi-select dropdown
  - **Default:** All enumerators
- **Sampling Variables:** Dynamic filters based on survey config
  - **Default:** All values

**Note:** All filters are applied globally to all dashboard components. The dashboard always shows data for the selected survey only.

#### 5.3.2 Cross-Page Navigation
- **"View Enumerator Breakdown" button:** Links to Enumerator Performance page
  - Preserves current filter context where applicable

#### 5.3.3 Issue Frequency Chart Controls
- **Display Limit:** Dropdown - "Top 5", "Top 10", "Top 20", "All"
  - **Default:** Top 5
- **Show All Button:** Display all issues regardless of limit
- **Click Interaction:** Clicking a bar filters the Submissions view to show only submissions with that issue

#### 5.3.4 Issues Over Time Chart Controls
- **Issue Type Filter:** Multi-select dropdown to select which issue types to display
  - **Default:** Top 5 issue types (by frequency)
- **Legend Interaction:** Click legend items to toggle visibility

#### 5.3.5 Export Button (Future Enhancement)
- **Format:** CSV/Excel
- **Includes:** All metrics and charts data (respects current filters)

### 5.4 Responsive Design
- **Desktop:** Full layout with all components visible
- **Tablet:** Stacked layout, charts resize appropriately
- **Mobile:** Single column, simplified charts, collapsible sections

### 5.5 Dark Mode Support
- Consistent with existing dark mode theme
- Accessible color contrasts for all charts

---

## 6. Component Architecture

### 6.1 Frontend Components

```
frontend/
├── components/
│   └── quality-dashboard/
│       ├── QualityOverviewDashboard.tsx  # Main container with state management
│       ├── StatusSummaryCards.tsx        # 5 status cards (Total, Approved, Pending, Flagged, Rejected)
│       ├── QualityMetricsCards.tsx       # 2 metric cards (Total Issues, Avg Issues)
│       ├── IssueFrequencyChart.tsx       # Horizontal bar chart with top N selector
│       ├── SubmissionStatusChart.tsx     # Line chart: status over time
│       ├── IssueTimeSeriesChart.tsx      # Line chart: issues by type over time
│       └── QualityFilters.tsx            # Date range, enumerator, sampling filters
├── pages/
│   └── QualityOverviewPage.tsx           # Page wrapper
├── services/
│   └── qualityApi.ts (new)               # API client for /api/quality/overview
└── types.ts (add quality overview types)
```

### 6.2 Backend Components

```
backend/
├── routers/
│   └── quality.py (new router)
│       └── get_quality_overview()        # Main endpoint
├── models.py (add Pydantic models)
│   ├── SubmissionStatusSummary
│   ├── QualityMetricsSummary
│   ├── IssueFrequency
│   ├── TemporalDataPoint
│   ├── IssueTimeSeriesPoint
│   └── QualityOverviewResponse
└── main.py (register quality router)
```

---

## 7. Technical Implementation Details

### 7.1 Backend Implementation

#### 7.1.1 Database Queries
- Use PostgreSQL JSONB functions (`jsonb_array_elements`, `jsonb_extract_path_text`)
- Aggregate with `GROUP BY` and window functions
- Leverage existing GIN index on `data_quality_issues`
- Consider materialized view for performance if data volume is very large

#### 7.1.2 Caching Strategy
- Cache API responses for 5 minutes
- Invalidate cache on new ETL run
- Use in-memory cache or Redis if available

#### 7.1.3 Performance Optimization
- Limit temporal data to reasonable date ranges (max 1 year)
- When no date filter is provided, consider defaulting to last 90 days for performance
- Use async queries where possible
- Consider background job for pre-aggregation if needed
- Optimize issue time series query to only fetch data for selected issue types

### 7.2 Frontend Implementation

#### 7.2.1 Chart Library
- **Recommendation:** `recharts` (React-friendly, good TypeScript support)
- **Installation:** `npm install recharts`
- **Alternative:** Chart.js with react-chartjs-2
- Ensure accessibility and dark mode support

#### 7.2.2 State Management
- Use React hooks (`useState`, `useEffect`)
- Consider React Query for caching and refetching (if available)
- Share filter state via URL query params for shareable links

#### 7.2.3 Data Fetching
- Fetch on component mount
- Refetch on filter changes
- Show loading states
- Handle errors gracefully

### 7.3 Integration Points
- **Survey Context:** Use existing `SurveyContext` for survey selection
- **Navigation:** Add to main navigation menu in `App.tsx`
- **Routing:** Add `'qualityOverview'` to `View` type
- **Link from Dashboard:** "View Quality Overview" button/link

---

## 8. Dependencies

### 8.1 New Dependencies
- **Frontend:** `recharts` (or alternative charting library)
- **Backend:** None (uses existing FastAPI/SQLAlchemy stack)

### 8.2 Existing Dependencies
- React, TypeScript
- FastAPI, SQLAlchemy, PostgreSQL
- Existing UI components (Badge, Spinner, etc.)

---

## 9. Success Metrics

### 9.1 User Engagement
- Daily active users on quality dashboard
- Average session duration
- Most viewed charts/sections

### 9.2 Performance Metrics
- API response time < 2 seconds
- Page load time < 3 seconds
- Chart render time < 1 second

### 9.3 Business Impact
- Reduction in time to identify quality issues
- Increase in proactive quality interventions
- Improvement in overall data quality scores

---

## 10. Acceptance Criteria

### Backend
- [ ] `/api/quality/overview` endpoint exists and returns correct data structure
- [ ] Endpoint requires `survey_id` parameter
- [ ] Endpoint supports optional `start_date`, `end_date`, `enumerator`, `sampling_filters` parameters
- [ ] API response time < 2 seconds for typical data volumes

### Frontend - Summary Cards
- [ ] 5 status cards display: Total, Approved, Pending, Flagged, Rejected
- [ ] 2 quality metric cards display: Total Issues, Avg Issues per Submission
- [ ] Status cards show count and percentage (except Total which shows count only)
- [ ] Clicking status cards filters the Submissions view to that status

### Frontend - Charts
- [ ] Issue frequency chart shows top 5 issues by default
- [ ] Issue frequency chart has dropdown to show Top 5/10/20/All
- [ ] Clicking issue bar filters Submissions view to that issue type
- [ ] Submission status over time chart shows trends accurately
- [ ] Issues over time chart displays issue-specific trends
- [ ] Issues over time chart allows filtering which issues to display

### Frontend - Filters & Navigation
- [ ] Dashboard uses selected survey from SurveyContext
- [ ] Date range filter defaults to "All Time"
- [ ] Enumerator filter works correctly
- [ ] Sampling variable filters work correctly
- [ ] "View Enumerator Breakdown" link navigates to Enumerator Performance page
- [ ] `'qualityOverview'` view added to App.tsx navigation

### UX & Polish
- [ ] Dashboard is responsive on mobile/tablet/desktop
- [ ] Dark mode is supported
- [ ] Loading states are shown during data fetch
- [ ] Error states are handled gracefully
- [ ] Charts have proper tooltips on hover

---

## 11. Future Enhancements (Phase 2)

1. **Real-time Updates:** WebSocket integration for live quality metrics
2. **Quality Alerts:** Notifications when quality drops below thresholds
3. **Predictive Quality Modeling:** ML-based quality predictions
4. **Custom Quality Score Formulas:** User-configurable scoring
5. **Quality Benchmarking:** Compare quality across surveys
6. **Drill-down Navigation:** Click charts to see submission details
7. **Quality Report Generation:** PDF export with charts
8. **Anomaly Detection Visualization:** Highlight unusual patterns
9. **Issue Correlation Analysis:** Analyze which issues frequently co-occur (if needed in future)

---

## 12. Implementation Plan

### Step 1: Backend API
**Files to create/modify:**
- `backend/models.py` - Add Pydantic response models
- `backend/routers/quality.py` - New router with `/api/quality/overview` endpoint
- `backend/main.py` - Register the quality router

**Tasks:**
1. Add Pydantic models: `SubmissionStatusSummary`, `QualityMetricsSummary`, `IssueFrequency`, `TemporalDataPoint`, `IssueTimeSeriesPoint`, `QualityOverviewResponse`
2. Implement `get_quality_overview()` endpoint with:
   - Status summary aggregation (count submissions by qa_status)
   - Quality metrics aggregation (count issues, calculate avg)
   - Issue frequency aggregation (unnest JSONB, group by check)
   - Temporal data aggregation (group by date)
   - Issue time series aggregation (group by date and check)
3. Support optional filters: date range, enumerator, sampling variables
4. Register router in main.py
5. Write unit tests

### Step 2: Frontend Setup
**Files to create/modify:**
- `frontend/types.ts` - Add TypeScript types matching API response
- `frontend/services/qualityApi.ts` - API client function
- `frontend/App.tsx` - Add `'qualityOverview'` to View type and navigation

**Tasks:**
1. Add TypeScript interfaces for API response
2. Create `fetchQualityOverview(surveyId, filters)` function
3. Add navigation button "Quality Overview" in App.tsx header
4. Add view case in App.tsx

### Step 3: Frontend Components
**Files to create:**
- `frontend/components/quality-dashboard/QualityOverviewDashboard.tsx`
- `frontend/components/quality-dashboard/StatusSummaryCards.tsx`
- `frontend/components/quality-dashboard/QualityMetricsCards.tsx`
- `frontend/components/quality-dashboard/IssueFrequencyChart.tsx`
- `frontend/components/quality-dashboard/SubmissionStatusChart.tsx`
- `frontend/components/quality-dashboard/IssueTimeSeriesChart.tsx`
- `frontend/components/quality-dashboard/QualityFilters.tsx`
- `frontend/pages/QualityOverviewPage.tsx`

**Tasks:**
1. Build `StatusSummaryCards` - 5 cards showing submission status counts
2. Build `QualityMetricsCards` - 2 cards showing issue metrics
3. Build `IssueFrequencyChart` - Horizontal bar chart with recharts
4. Build `SubmissionStatusChart` - Line chart showing status trends
5. Build `IssueTimeSeriesChart` - Line chart showing issue trends
6. Build `QualityFilters` - Date range, enumerator, sampling filters
7. Assemble `QualityOverviewDashboard` - Main container with state
8. Create `QualityOverviewPage` - Page wrapper

### Step 4: Integration & Polish
**Tasks:**
1. Connect dashboard to SurveyContext
2. Implement click-through to filtered Submissions view
3. Add "View Enumerator Breakdown" navigation link
4. Add loading states and error handling
5. Test responsive design
6. Test dark mode
7. Performance testing with real data

---

## 13. Current Implementation Status

### Status: **READY FOR IMPLEMENTATION** 🚀

### What's Missing

#### Backend (0% complete)
- ❌ No `backend/routers/quality.py` router
- ❌ No `/api/quality/overview` endpoint
- ❌ No Pydantic models for quality overview response
- ❌ Router not registered in `backend/main.py`

#### Frontend (0% complete)
- ⏳ Folder structure exists: `frontend/components/quality-dashboard/` (empty)
- ❌ No quality dashboard components implemented
- ❌ No `frontend/services/qualityApi.ts`
- ❌ No `QualityOverviewPage.tsx`
- ❌ No navigation entry in `App.tsx`
- ❌ No `'qualityOverview'` view type in `App.tsx`

### What Already Exists (Ready to Use)
- ✅ `recharts@3.5.1` already installed in `package.json`
- ✅ User authentication fully implemented
- ✅ `SurveyContext` for survey selection

### What Already Exists (Related Features)

✅ **Data Quality Infrastructure:**
- `data_quality_issues` field in submissions (JSONB array)
- `qa_status` field (PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED)
- Quality checks configuration in survey settings
- GIN index on `data_quality_issues` column

✅ **UI Components Showing Quality:**
- `SubmissionDetail.tsx` displays quality issues
- `SubmissionListItem.tsx` shows issue counts
- `PerformanceDataView.tsx` has quality tab (enumerator-level) - **Note:** Enumerator-level analysis is handled here, not in the quality dashboard

✅ **Related API Endpoints:**
- `/api/submissions` returns quality issues
- `/api/progress/performance` includes quality metrics
- `/api/auth/*` - User authentication (login, register)
- `/api/users/*` - User management and Kobo API key storage
- `/api/surveys/{id}/rules` - Validation rules CRUD

---

## 14. Notes

- The existing database schema already has a GIN index on `data_quality_issues`, which will help with JSONB queries
- The `qa_status` field uses values: PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED
- Quality issues are stored as JSONB array with structure: `[{check, field, value, message}, ...]`
- The system already has filtering infrastructure that can be reused
- Consider reusing existing UI patterns from `ProgressDataView` and `PerformanceDataView` components
- **Enumerator Analysis:** Enumerator-level quality analysis is intentionally excluded from this dashboard as it's already available in the Enumerator Performance page. This dashboard focuses on aggregate quality patterns and trends. Cross-links between pages will be provided.
- **Default Behavior:** 
  - Dashboard shows data for the **selected survey only** (survey_id is required)
  - Date range defaults to **All Time** (no date filter)
  - Issue frequency shows **Top 5** by default
- **Cross-Page Navigation:** "View Enumerator Breakdown" button links to Enumerator Performance page

---

## 15. Estimated Effort

- **Backend Development:** 2-4 days (simplified without enumerator stats and correlations)
- **Frontend Development:** 4-6 days
- **Testing & Polish:** 2-3 days
- **Total:** ~1.5-2 weeks

---

## 16. Related Files

- Specification Document: `docs/specs/quality-dashboard-spec.md`
- Related Components:
  - `frontend/components/SubmissionDetail.tsx`
  - `frontend/components/SubmissionListItem.tsx`
  - `frontend/components/progress-tracker/PerformanceDataView.tsx`
  - `backend/routers/progress.py`
  - `backend/routers/submissions.py`

---

## 17. Links

- GitHub Issue: https://github.com/paulvercoustre/field-compass/issues/9
- Repository: https://github.com/paulvercoustre/field-compass

---

**Last Updated:** January 10, 2025  
**Document Version:** 2.0

### Revision History
- **v2.0** (Jan 10, 2025): Confirmed design decisions - selected survey only, all time default, revised summary cards (5 status + 2 metrics), Option A for enumerator stats (separate pages with cross-links)
- **v1.2** (Jan 2025): Simplified scope - removed enumerator stats and correlations from Phase 1
- **v1.0** (Jan 2025): Initial specification


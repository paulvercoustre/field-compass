# Issue #9: Feature: Data Quality Issues Overview Dashboard

**Repository:** [paulvercoustre/field-compass](https://github.com/paulvercoustre/field-compass)  
**Issue Number:** #9  
**Status:** Open / Not Implemented  
**Type:** Feature Request  
**Priority:** Medium

---

## Issue Description

This issue tracks the implementation of a comprehensive Data Quality Issues Overview Dashboard that provides a high-level, aggregated view of data quality across all survey submissions. The dashboard will help users identify common quality problems, track quality trends over time, and prioritize review efforts.

---

## Feature Specification: Data Quality Issues Overview Dashboard

### 1. Overview

#### 1.1 Purpose
The Data Quality Issues Overview Dashboard provides a high-level, aggregated view of data quality across all survey submissions. It helps users identify common quality problems, track quality trends over time, and prioritize review efforts.

#### 1.2 Goals
- **Identify Patterns:** Quickly spot which quality checks are failing most frequently
- **Track Trends:** Monitor if data quality is improving or deteriorating over time
- **Focus Effort:** Highlight specific issues that need immediate attention
- **Monitor Health:** Provide an overall "Quality Score" for the survey

#### 1.3 Target Users
- QA Managers
- Field Supervisors
- Data Analysts
- Survey Coordinators

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
- `survey_id` (optional, UUID): Filter by survey ID (default: all surveys)
- `start_date` (optional, ISO date string): Start of date range (YYYY-MM-DD)
- `end_date` (optional, ISO date string): End of date range (YYYY-MM-DD)
- `enumerator` (optional, string): Filter by enumerator ID (default: all enumerators)
- `sampling_filters` (optional, string): Filter by sampling variables (same format as submissions endpoint: `variable1=value1,value2;variable2=value3`, default: all)
- `issue_types` (optional, string): Comma-separated list of issue types to filter (default: all issues)

**Response Model:**

```python
class IssueFrequency(BaseModel):
    check: str  # Issue type (e.g., "duration_too_short", "outlier_age")
    count: int  # Number of occurrences
    percentage: float  # Percentage of total submissions
    affected_submissions: int  # Number of unique submissions affected

class TemporalIssuePoint(BaseModel):
    date: str  # ISO date string (YYYY-MM-DD)
    total_issues: int
    issues_by_type: Dict[str, int]  # Map of check -> count
    submissions_count: int
    flagged_count: int
    approved_count: int
    pending_count: int
    rejected_count: int

class QualityHealthMetrics(BaseModel):
    overall_quality_score: float  # 0-100
    total_submissions: int
    submissions_with_issues: int
    submissions_approved: int
    submissions_flagged: int
    submissions_pending: int
    submissions_rejected: int
    avg_issues_per_submission: float
    quality_trend: str  # "improving", "declining", "stable"
    trend_percentage: float  # Percentage change in quality score

class IssueTimeSeriesPoint(BaseModel):
    date: str  # ISO date string (YYYY-MM-DD)
    issue_counts: Dict[str, int]  # Map of check -> count for this date

class QualityOverviewResponse(BaseModel):
    # Summary metrics
    health: QualityHealthMetrics
    
    # Issue frequency (all issues, or filtered subset)
    issue_frequency: List[IssueFrequency]
    
    # Temporal data (daily aggregation) - quality status over time
    temporal_data: List[TemporalIssuePoint]
    
    # Issue-specific time series (for selected issue types)
    issue_time_series: List[IssueTimeSeriesPoint]
    
    # Date range of data
    date_range: Dict[str, str]  # {"start": "2024-01-01", "end": "2024-01-31"}
```

**Example Response:**
```json
{
  "health": {
    "overall_quality_score": 78.5,
    "total_submissions": 1250,
    "submissions_with_issues": 320,
    "submissions_approved": 850,
    "submissions_flagged": 280,
    "submissions_pending": 100,
    "submissions_rejected": 20,
    "avg_issues_per_submission": 0.45,
    "quality_trend": "improving",
    "trend_percentage": 5.2
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
      "total_issues": 45,
      "issues_by_type": {
        "duration_too_short": 12,
        "outlier_age": 8
      },
      "submissions_count": 50,
      "flagged_count": 15,
      "approved_count": 30,
      "pending_count": 5,
      "rejected_count": 0
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
- By default, return data for all submissions (no filters applied unless specified)
- When `issue_types` parameter is provided, filter both issue frequency and issue time series to only those types
- Consider materialized view for performance if data volume is very large

---

## 5. UI/UX Design Specification

### 5.1 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Data Quality Overview Dashboard                    [Refresh]│
├─────────────────────────────────────────────────────────────┤
│  [Survey: All] [Date Range: Last 30 days] [Filters ▼]       │
│  [Enumerator: All] [Sampling Variables: All]                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ Quality  │ │ Total   │ │ Flagged │ │ Avg      │         │
│  │ Score    │ │ Issues  │ │ Subms   │ │ Issues   │         │
│  │ 78.5%    │ │ 562      │ │ 280     │ │ 0.45     │         │
│  │ ↗ +5.2%  │ │          │ │          │ │          │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Issue Frequency [Top 5 ▼] [Select Issues...] [Show All]│   │
│  │ ┌──────────────────────────────────────────────────┐ │   │
│  │ │ duration_too_short        ████████████ 145 (12%) │ │   │
│  │ │ outlier_age               ████████ 89 (7%)       │ │   │
│  │ │ date_out_of_range         ██████ 67 (5%)          │ │   │
│  │ │ interview_on_weekend      ████ 45 (4%)           │ │   │
│  │ │ missing_required_field     ███ 32 (3%)           │ │   │
│  │ └──────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────┐ ┌──────────────────────────┐   │
│  │ Quality Trends Over Time  │ │ Issues Over Time         │   │
│  │ [Line Chart]              │ │ [Line Chart]              │   │
│  │                           │ │ [Filter: All Issues ▼]    │   │
│  │  Issues ────             │ │  duration_too_short ──── │   │
│  │  Approved ──              │ │  outlier_age ────        │   │
│  │  Flagged ───              │ │  date_out_of_range ────  │   │
│  └──────────────────────────┘ └──────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Component Breakdown

#### 5.2.1 Summary Cards (Top Row)
- **Quality Score Card**
  - Large number: Overall quality score (0-100%)
  - Trend indicator: Arrow (↑/↓) + percentage change
  - Color coding: Green (>80%), Yellow (60-80%), Red (<60%)
  - Clickable: Links to filtered submission list
  
- **Total Issues Card**
  - Total count of all quality issues
  - Subtitle: "across X submissions"
  
- **Flagged Submissions Card**
  - Count of submissions with `qa_status = FLAGGED`
  - Clickable: Links to filtered submission list
  
- **Average Issues Card**
  - Average issues per submission
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
- **Survey Selector:** Dropdown - "All Surveys" or specific survey
  - **Default:** All surveys (or selected survey from context if available)
- **Date Range Picker:** 
  - **Presets:** Last 7/30/90 days, This month, Last month, Custom
  - **Default:** Last 30 days (or all time if no date filter)
- **Enumerator Filter:** Multi-select dropdown
  - **Default:** All enumerators
- **Sampling Variables:** Dynamic filters based on survey config
  - **Default:** All values

**Note:** All filters are applied globally to all dashboard components. When no filters are set, the dashboard shows data for all submissions across all surveys.

#### 5.3.2 Issue Frequency Chart Controls
- **Display Limit:** Dropdown - "Top 5", "Top 10", "Top 20", "All"
  - **Default:** Top 5
- **Issue Type Filter:** Multi-select dropdown to show specific issues
- **Show All Button:** Display all issues regardless of limit

#### 5.3.3 Issues Over Time Chart Controls
- **Issue Type Filter:** Multi-select dropdown to select which issue types to display
  - **Default:** All issue types (or top 5 if too many for readability)

#### 5.3.4 Export Button
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
│       ├── QualityOverviewDashboard.tsx (main container)
│       ├── SummaryCards.tsx
│       │   ├── QualityScoreCard.tsx
│       │   ├── TotalIssuesCard.tsx
│       │   ├── FlaggedSubmissionsCard.tsx
│       │   └── AvgIssuesCard.tsx
│       ├── IssueFrequencyChart.tsx
│       ├── QualityTrendsChart.tsx
│       ├── IssueTimeSeriesChart.tsx
│       └── GlobalFilters.tsx
├── pages/
│   └── QualityOverviewPage.tsx
├── services/
│   └── qualityApi.ts (new)
└── types.ts (add quality overview types)
```

### 6.2 Backend Components

```
backend/
├── routers/
│   └── quality.py (new router)
│       ├── get_quality_overview() (main endpoint)
│       └── helpers/
│           ├── aggregate_issue_frequency()
│           ├── aggregate_temporal_data()
│           ├── aggregate_issue_time_series()
│           └── calculate_quality_health()
└── models.py (add Pydantic models)
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

- [ ] Dashboard displays all summary cards with accurate data
- [ ] Issue frequency chart shows top 5 issues by default
- [ ] Issue frequency chart allows filtering to specific issues or showing all
- [ ] Quality trends chart displays temporal data accurately
- [ ] Issues over time chart displays selected issue types correctly
- [ ] Issues over time chart filter works correctly
- [ ] Global filters (date, enumerator, sampling variables) work correctly and update all components
- [ ] Dashboard shows all submissions by default when no filters are applied
- [ ] Dashboard is responsive on mobile/tablet/desktop
- [ ] Dark mode is supported
- [ ] API endpoint returns data in < 2 seconds
- [ ] Error states are handled gracefully
- [ ] Loading states are shown during data fetch
- [ ] Export functionality works correctly
- [ ] Dashboard integrates with existing navigation
- [ ] Clicking on issue types filters submissions correctly

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

### Phase 1: Backend API (Week 1)
1. Create `backend/routers/quality.py`
2. Implement aggregations for:
   - Issue frequency (with filtering support)
   - Temporal data (quality status over time)
   - Issue-specific time series
   - Quality health metrics
3. Add Pydantic models to `backend/models.py`
4. Register router in `backend/main.py`
5. Write unit tests

### Phase 2: Frontend Setup (Week 1-2)
1. Install `recharts` dependency
2. Add TypeScript types to `frontend/types.ts`
3. Create `frontend/services/qualityApi.ts`
4. Create component structure

### Phase 3: Frontend Components (Week 2-3)
1. Build summary cards
2. Build global filters component
3. Build issue frequency chart (with filtering controls)
4. Build quality trends chart
5. Build issues over time chart (with issue type filter)
6. Assemble main dashboard page

### Phase 4: Integration & Testing (Week 3-4)
1. Add navigation in `App.tsx`
2. Integrate with survey context
3. Test with real data
4. Performance optimization
5. Responsive design testing
6. Dark mode testing

### Phase 5: Polish & Documentation (Week 4)
1. Error handling
2. Loading states
3. Export functionality
4. Documentation
5. User acceptance testing

---

## 13. Current Implementation Status

### Status: **NOT IMPLEMENTED** ❌

### What's Missing

#### Backend (0% complete)
- ❌ No `backend/routers/quality.py` router
- ❌ No `/api/quality/overview` endpoint
- ❌ No Pydantic models for quality overview response
- ❌ Router not registered in `backend/main.py`

#### Frontend (0% complete)
- ❌ No quality dashboard components
- ❌ No `frontend/services/qualityApi.ts`
- ❌ No `QualityOverviewPage.tsx`
- ❌ No navigation entry in `App.tsx`
- ❌ No charting library installed (spec recommends `recharts`)
- ❌ No global filters component

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

---

## 14. Notes

- The existing database schema already has a GIN index on `data_quality_issues`, which will help with JSONB queries
- The `qa_status` field uses values: PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED
- Quality issues are stored as JSONB array with structure: `[{check, field, value, message}, ...]`
- The system already has filtering infrastructure that can be reused
- Consider reusing existing UI patterns from `ProgressDataView` and `PerformanceDataView` components
- **Enumerator Analysis:** Enumerator-level quality analysis is intentionally excluded from this dashboard as it's already available in the Enumerator Performance tab. This dashboard focuses on aggregate quality patterns and trends.
- **Default Behavior:** By default, the dashboard shows data for all submissions across all surveys. Users can apply filters to narrow down the view.
- **Issue Frequency:** Defaults to top 5 issues for better readability, with options to show more or filter to specific issues.

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

**Last Updated:** 2025-01-27  
**Document Version:** 1.1


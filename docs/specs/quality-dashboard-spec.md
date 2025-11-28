# Feature Specification: Data Quality Issues Overview Dashboard

## 1. Overview

### 1.1 Purpose
The Data Quality Issues Overview Dashboard provides a high-level, aggregated view of data quality across all survey submissions. It helps users identify common quality problems, track quality trends over time, and prioritize review efforts.

### 1.2 Goals
- **Identify Patterns:** Quickly spot which quality checks are failing most frequently
- **Track Trends:** Monitor if data quality is improving or deteriorating over time
- **Focus Effort:** Highlight enumerators or specific issues that need immediate attention
- **Monitor Health:** Provide an overall "Quality Score" for the survey

### 1.3 Target Users
- QA Managers
- Field Supervisors
- Data Analysts
- Survey Coordinators

---

## 2. User Stories

### Primary User Stories
1. **As a QA Manager**, I want to see the most common quality issues so I can prioritize training materials for enumerators.
2. **As a Field Supervisor**, I want to see quality trends over time to assess if recent feedback has improved performance.
3. **As a Data Analyst**, I want to see which enumerators have the most issues so I can target support and training.
4. **As a Survey Coordinator**, I want to see overall quality health metrics to report to stakeholders.
5. **As a QA Reviewer**, I want to click on an issue type to see all affected submissions.

### Secondary User Stories
6. Filter quality data by date range, enumerator, or sampling variables
7. Export quality metrics for reporting
8. Compare quality metrics across different time periods
9. See which issues frequently co-occur
10. Get alerts when quality drops below thresholds (future enhancement)

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

#### Enumerator Metrics
- Issues per enumerator
- Most problematic enumerators
- Enumerator quality scores

#### Issue Correlation
- Co-occurrence of issue types
- Common issue combinations

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
- `survey_id` (optional, UUID): Filter by survey ID
- `start_date` (optional, ISO date string): Start of date range (YYYY-MM-DD)
- `end_date` (optional, ISO date string): End of date range (YYYY-MM-DD)
- `enumerator` (optional, string): Filter by enumerator ID
- `sampling_filters` (optional, string): Filter by sampling variables (same format as submissions endpoint: `variable1=value1,value2;variable2=value3`)

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

class EnumeratorIssueStats(BaseModel):
    enumerator_id: str
    total_submissions: int
    total_issues: int
    avg_issues_per_submission: float
    issues_by_type: Dict[str, int]  # Map of check -> count
    quality_score: float  # 0-100, based on approval rate and issue count
    flagged_count: int
    approved_count: int

class IssueCorrelation(BaseModel):
    issue_pair: Tuple[str, str]  # Two issue types
    co_occurrence_count: int  # How many submissions have both
    co_occurrence_percentage: float  # Percentage of submissions with issue1 that also have issue2

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

class QualityOverviewResponse(BaseModel):
    # Summary metrics
    health: QualityHealthMetrics
    
    # Issue frequency (top N, default 20)
    issue_frequency: List[IssueFrequency]
    
    # Temporal data (daily aggregation)
    temporal_data: List[TemporalIssuePoint]
    
    # Enumerator breakdown (top N problematic, default 10)
    enumerator_stats: List[EnumeratorIssueStats]
    
    # Issue correlations (top N pairs, default 15)
    issue_correlations: List[IssueCorrelation]
    
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
  "enumerator_stats": [
    {
      "enumerator_id": "ENUM001",
      "total_submissions": 120,
      "total_issues": 65,
      "avg_issues_per_submission": 0.54,
      "issues_by_type": {
        "duration_too_short": 25,
        "outlier_age": 15
      },
      "quality_score": 72.3,
      "flagged_count": 35,
      "approved_count": 80
    }
  ],
  "issue_correlations": [
    {
      "issue_pair": ["duration_too_short", "outlier_age"],
      "co_occurrence_count": 23,
      "co_occurrence_percentage": 15.9
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
- Support pagination for large enumerator lists if needed
- Consider materialized view for performance if data volume is very large

---

## 5. UI/UX Design Specification

### 5.1 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Data Quality Overview Dashboard                    [Refresh]│
├─────────────────────────────────────────────────────────────┤
│  [Survey Selector] [Date Range: Last 30 days ▼] [Filters ▼]│
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
│  │ Issue Frequency (Top 10)                              │   │
│  │ ┌──────────────────────────────────────────────────┐ │   │
│  │ │ duration_too_short        ████████████ 145 (12%) │ │   │
│  │ │ outlier_age               ████████ 89 (7%)       │ │   │
│  │ │ date_out_of_range         ██████ 67 (5%)          │ │   │
│  │ │ interview_on_weekend      ████ 45 (4%)           │ │   │
│  │ │ ...                                              │ │   │
│  │ └──────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────┐ ┌──────────────────────────┐   │
│  │ Quality Trends Over Time  │ │ Issue Correlations       │   │
│  │ [Line Chart]              │ │ [Heatmap/Matrix]         │   │
│  │                           │ │                         │   │
│  │  Issues ────             │ │  [Correlation matrix]  │   │
│  │  Approved ──              │ │                         │   │
│  │  Flagged ───              │ │                         │   │
│  └──────────────────────────┘ └──────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Enumerator Quality Performance (Top 10)               │   │
│  │ ┌──────┬──────┬────────┬────────┬──────────────────┐ │   │
│  │ │Enum  │Subs  │Issues  │Score   │Top Issues        │ │   │
│  │ ├──────┼──────┼────────┼────────┼──────────────────┤ │   │
│  │ │ENUM01│ 120  │  65    │ 72.3%  │duration (25)     │ │   │
│  │ │ENUM02│  95  │  45    │ 78.5%  │outlier_age (15)  │ │   │
│  │ └──────┴──────┴────────┴────────┴──────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
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
- **Limit:** Top 10-20 issues (configurable)

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

#### 5.2.4 Issue Correlations
- **Type:** Heatmap or correlation matrix
- **Shows:** Which issues frequently co-occur
- **Color Intensity:** Strength of correlation
- **Interactive:** Click cell to see affected submissions
- **Limit:** Top 15-20 pairs

#### 5.2.5 Enumerator Quality Performance
- **Type:** Table with sortable columns
- **Columns:**
  - Enumerator ID
  - Total Submissions
  - Total Issues
  - Avg Issues/Submission
  - Quality Score
  - Top Issue Types
- **Interactive:** Sortable, click enumerator to filter
- **Limit:** Top 10 problematic (configurable)

### 5.3 Filters and Controls

#### 5.3.1 Date Range Picker
- **Presets:** Last 7/30/90 days, This month, Last month, Custom
- **Default:** Last 30 days

#### 5.3.2 Survey Selector
- **Dropdown:** All surveys or specific survey
- **Default:** Selected survey from context (if available)

#### 5.3.3 Additional Filters
- **Enumerator:** Multi-select dropdown
- **Sampling Variables:** Dynamic filters based on survey config
- **Issue Type:** Multi-select (filter to specific issues)

#### 5.3.4 Export Button
- **Format:** CSV/Excel
- **Includes:** All metrics and charts data

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
│       ├── IssueCorrelationMatrix.tsx
│       └── EnumeratorQualityTable.tsx
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
│           ├── aggregate_enumerator_stats()
│           ├── calculate_issue_correlations()
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
- Paginate enumerator stats if many enumerators
- Use async queries where possible
- Consider background job for pre-aggregation if needed

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
- [ ] Issue frequency chart shows top issues correctly
- [ ] Quality trends chart displays temporal data accurately
- [ ] Issue correlation matrix shows co-occurrence patterns
- [ ] Enumerator table is sortable and filterable
- [ ] All filters work correctly and update data
- [ ] Dashboard is responsive on mobile/tablet/desktop
- [ ] Dark mode is supported
- [ ] API endpoint returns data in < 2 seconds
- [ ] Error states are handled gracefully
- [ ] Loading states are shown during data fetch
- [ ] Export functionality works correctly
- [ ] Dashboard integrates with existing navigation
- [ ] Clicking on issue types filters submissions correctly
- [ ] Clicking on enumerators filters submissions correctly

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

---

## 12. Implementation Plan

### Phase 1: Backend API (Week 1)
1. Create `backend/routers/quality.py`
2. Implement aggregations for:
   - Issue frequency
   - Temporal data
   - Enumerator stats
   - Issue correlations
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
2. Build issue frequency chart
3. Build quality trends chart
4. Build issue correlation matrix
5. Build enumerator quality table
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

## 13. Notes

- The existing database schema already has a GIN index on `data_quality_issues`, which will help with JSONB queries
- The `qa_status` field uses values: PENDING_APPROVAL, FLAGGED, APPROVED, REJECTED
- Quality issues are stored as JSONB array with structure: `[{check, field, value, message}, ...]`
- The system already has filtering infrastructure that can be reused
- Consider reusing existing UI patterns from `ProgressDataView` and `PerformanceDataView` components

---

## 14. Related Issues/PRs

- Link to any related issues or previous discussions
- Reference existing progress/performance tracking features


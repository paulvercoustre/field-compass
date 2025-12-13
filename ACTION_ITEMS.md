# Action Items & TODOs - Field Compass

**Generated**: 2025-01-XX  
**Source**: Review of all markdown files and codebase

---

## 🔴 HIGH PRIORITY - Critical Functionality

### 1. Audit Log Processing - Performance Metrics (IMMEDIATE)
**Location**: `backend/routers/progress.py` (lines 327-520)  
**Status**: ✅ **COMPLETED** (Implementation was already working, improved with validation)

**TODOs**:
- [x] Calculate `avgActiveTime` from audit logs for enumerator performance
- [x] Calculate `avgTotalTime` from audit logs for enumerator performance  
- [x] Calculate `avgDkRate` from submission data for enumerator performance
- [x] Make `survey_id` required parameter (improvement)
- [x] Add validation and error handling (improvement)

**Context**: 
- Audit log processing is implemented in `backend/etl/audit_processor.py`
- `active_interview_time` and `total_duration` are calculated and stored in `submission_data` during ETL
- Metrics are aggregated per enumerator in `get_performance_data()` function
- **Improvement**: Made `survey_id` required to ensure correct aggregation and use of survey-specific configs

**Files modified**:
- `backend/routers/progress.py` - `get_performance_data()` function (lines 327-520)
- `frontend/services/progressApi.ts` - Updated to require `surveyId`
- `frontend/pages/ProgressTracker.tsx` - Added validation for empty surveys

**Implementation Details**:
- Metrics are extracted from `submission_data.active_interview_time` and `submission_data.total_duration`
- Aggregated per enumerator using survey-specific `enumerator_field` from config
- DK rates calculated using survey-specific `dk_value` and `dk_string_value` from config
- All metrics tested and verified working with real data

**Actual Effort**: 2-3 hours (testing + improvements)

---

### 2. Form Edition Detection Fix
**Location**: ETL pipeline  
**Status**: ✅ **COMPLETED**

**TODOs**:
- [x] Fix the logic that determines when a submission is marked as "edited" (currently incorrect)
- [x] Investigate Kobo API to find reliable edit indicators
- [x] Implement edit detection using `meta/deprecatedID` field
- [x] Remove flawed timestamp-based comparison logic
- [x] Update merge_submission() to use new detection method
- [x] Create comparison script to investigate edit indicators

**Context**: 
- Previous logic compared `end` timestamp with `_submission_time + threshold`, which was incorrect
- Investigation revealed that Kobo sets `meta/deprecatedID` field when a submission is edited
- This field contains the previous UUID before the edit
- Current UUID is in `_uuid` field, old UUID is in `meta/deprecatedID`

**Files modified**:
- `backend/etl/data_merger.py` - Rewrote `is_edited_submission()` to check for `deprecatedID`
- `backend/etl/kobo_fetcher.py` - Added `get_submission_by_uuid()` method
- `backend/etl/pipeline.py` - Updated to pass `kobo_data` for deprecatedID detection
- `backend/tests/test_data_merger.py` - Updated tests to use deprecatedID
- `backend/scripts/compare_submissions.py` - New script for comparing edited/non-edited submissions

**Implementation Details**:
- Edit detection now uses `meta/deprecatedID` field as the primary (and only) indicator
- If `deprecatedID` exists in Kobo data → submission was edited
- Removed UUID comparison and JSON diff checks from detection (kept diff for history tracking)
- Simplified function signature - only needs `kobo_data` parameter
- JSON diff still calculated for history records (to show what changed)

**Actual Effort**: 3-4 hours (investigation + implementation + testing)

---

### 3. Update Kobo Link Wording and Target
**Location**: Frontend components  
**Status**: Not started

**TODOs**:
- [ ] Change "View in kobo" link text to "Edit in kobo"
- [ ] Update link to redirect to Kobo form edit page (instead of view page)
- [ ] Verify correct Kobo URL format for form editing

**Files to modify**:
- Frontend components that display Kobo links (likely `SubmissionDetail.tsx` or similar)

**Estimated Effort**: 1-2 hours

---

### 4. User System with Kobo API Key Management
**Location**: Backend authentication & user management  
**Status**: Not started

**TODOs**:
- [ ] Implement full user lifecycle (registration, management, deletion)
- [ ] Move Kobo API key from hardcoded environment variable to user-owned configuration
- [ ] Add user authentication system
- [ ] Create user management UI
- [ ] Secure API key storage (encryption at rest)

**Files to create/modify**:
- `backend/routers/users.py` (create)
- `backend/database/models.py` - Add user table
- `backend/database/schema.sql` - Add user schema
- Frontend user management components

**Estimated Effort**: 1-2 weeks

---

### 5. GitHub Issue #7 - Kobo Modal Auto-Open
**Location**: GitHub Issue #7  
**Status**: Needs investigation

**Action Items**:
- [ ] Investigate Kobo's URL format and deep linking capabilities
- [ ] Test DOM structure and modal triggering mechanism
- [ ] Determine timing and synchronization requirements
- [ ] Choose appropriate solution approach
- [ ] Implement solution in `SubmissionDetail.tsx`
- [ ] Test all test cases
- [ ] Verify browser compatibility

**Files**:
- `frontend/components/SubmissionDetail.tsx`

**Estimated Effort**: 1-2 days (depending on solution approach)

---

## 🟡 MEDIUM PRIORITY - Important Improvements

### 3. Testing Suite Implementation
**Location**: `PROGRESS.md` (lines 129-142)  
**Status**: 10% complete (manual testing done)

**TODOs**:
- [ ] Unit tests for ETL components
- [ ] Integration tests for API endpoints
- [ ] Frontend component tests
- [ ] E2E tests

**Files**:
- `backend/tests/` (expand existing test files)
- Create frontend test files

**Estimated Effort**: 3-5 days

---

### 4. HFC Engine Expression Evaluator Security
**Location**: `PROGRESS.md` (lines 230-232), `CHANGES_REVIEW.md` (lines 222-224)  
**Status**: Current implementation uses `eval()` which is unsafe

**TODOs**:
- [ ] Replace `eval()` with safe expression parser (e.g., `simpleeval`)
- [ ] Improve security and reliability
- [ ] Test all existing validation rules still work

**Files**:
- `backend/etl/hfc_engine.py` - `_safe_eval()` method (lines 427-490)

**Estimated Effort**: 1-2 days

---

### 5. Survey Deletion Cascade
**Location**: `backend/routers/surveys.py` (line 199)  
**Status**: Currently only deletes survey config

**TODOs**:
- [ ] Implement cascade delete for related data:
  - Submissions (submissions_current, submissions_history)
  - Validation rules
  - Other related records
- [ ] Handle foreign key constraints properly
- [ ] Add confirmation/soft delete option (optional)

**Files**:
- `backend/routers/surveys.py` - `delete_survey()` function

**Estimated Effort**: 2-3 hours

---

### 6. ETL Dry Run Mode
**Location**: `backend/scripts/run_etl.py` (line 59)  
**Status**: Flag exists but not implemented

**TODOs**:
- [ ] Implement dry run mode that:
  - Fetches submissions from Kobo
  - Shows what would be processed
  - Does NOT write to database
  - Provides statistics preview

**Files**:
- `backend/scripts/run_etl.py`
- `backend/etl/pipeline.py` (may need dry_run parameter)

**Estimated Effort**: 2-3 hours

---

### 7. Post-Basic-Info Quality Check Prompt
**Location**: Survey creation flow
**Status**: ✅ Completed

**TODOs**:
- [x] Add popup after basic survey info completion asking if user wants to configure data quality checks now or later
- [x] If "Now", redirect to the survey's data quality check form in edit mode
- [x] If "Later", allow user to continue and configure later

**Files to modify**:
- `frontend/components/QualityCheckPromptModal.tsx` (new)
- `frontend/pages/CreateSurveyPage.tsx`
- `frontend/pages/SurveySettingsPage.tsx`
- `frontend/App.tsx`

**Actual Effort**: 4-5 hours (including debugging survey selection issues)

---

### 8. Form Validation Button
**Location**: Survey/Kobo form interface  
**Status**: Not started / Blocked on Kobo capabilities

**TODOs**:
- [ ] Investigate Kobo website capabilities for form validation
- [ ] Add button that validates the form (depends on Kobo website build)
- [ ] Determine if validation can be triggered programmatically or via URL parameters
- [ ] Implement validation trigger if possible

**Files to modify**:
- Frontend components related to survey/form management

**Estimated Effort**: 1-2 days (investigation + implementation, if feasible)

---

### 9. Dataset-Level Quality Checks
**Location**: Quality checks system  
**Status**: Not started

**TODOs**:
- [ ] Implement dataset-level quality checks (as opposed to submission-level)
- [ ] Decide placement: overview dashboard vs dedicated area
- [ ] Design checks that analyze entire dataset (e.g., completeness across submissions, consistency, outliers)
- [ ] Create UI to display dataset-level quality metrics

**Files to create/modify**:
- `backend/etl/quality_checks.py` (may need new module)
- `backend/routers/quality.py` (may need new endpoint)
- Frontend dashboard/quality components

**Estimated Effort**: 3-5 days

---

### 10. Overview Dashboard
**Location**: Frontend dashboard  
**Status**: Not started

**TODOs**:
- [ ] Build overview dashboard page
- [ ] Decide whether dataset-level quality checks should be in this page or separate
- [ ] Include key metrics, survey status, recent activity
- [ ] Make it visually appealing and informative

**Files to create/modify**:
- `frontend/pages/DashboardPage.tsx` (create or expand)
- Dashboard components

**Estimated Effort**: 3-5 days

---

### 11. Enumerator Performance Page UX Improvements
**Location**: Enumerator performance page  
**Status**: Not started

**TODOs**:
- [ ] Improve visuals and make it more action-oriented
- [ ] Add charts/graphs for better data visualization
- [ ] Make performance metrics more actionable
- [ ] Incorporate new metrics once audit log aggregation is complete (item #1)

**Files to modify**:
- `frontend/pages/EnumeratorPerformancePage.tsx` (or similar)
- Performance visualization components

**Estimated Effort**: 2-3 days

---

### 12. Qualitative Data Checks
**Location**: Quality checks system  
**Status**: Not started

**TODOs**:
- [ ] Implement checks to assess if response is answering the question (not misunderstood)
- [ ] Check if answer contains all elements required
- [ ] Assess if answer is high quality/rich
- [ ] Implement scoring system for qualitative checks
- [ ] May require NLP/AI capabilities for text analysis

**Files to create/modify**:
- `backend/etl/qualitative_checks.py` (create new module)
- Quality scoring logic
- Frontend display of qualitative scores

**Estimated Effort**: 1-2 weeks (depending on complexity of NLP requirements)

---

## 🟢 LOW PRIORITY - Nice to Have

### 13. Airflow DAG Setup
**Location**: `PROGRESS.md` (lines 78-87, 196-200, 278-281)  
**Status**: Not started (manual ETL trigger via UI is working)

**TODOs**:
- [ ] Create Airflow DAG definition for scheduled ETL runs
- [ ] Test locally with Airflow
- [ ] Configure for Cloud Composer (GCP)
- [ ] Add error handling and retry logic
- [ ] Set up monitoring and alerting

**Estimated Effort**: 2-3 days

**Note**: Lower priority since manual ETL trigger via UI is working

---

### 14. ETL Performance Optimization
**Location**: `PROGRESS.md` (lines 234-237), `backend/etl/README.md` (lines 158-160)  
**Status**: Currently processes sequentially

**TODOs**:
- [ ] Parallelize ETL processing for large datasets
- [ ] Batch database commits (instead of per-submission)
- [ ] Optimize database queries
- [ ] Add performance monitoring

**Files**:
- `backend/etl/pipeline.py`
- `backend/etl/data_merger.py`

**Estimated Effort**: 2-3 days

---

### 15. Validation Rules API
**Location**: `PROGRESS.md` (lines 248-251)  
**Status**: Rules exist but no CRUD API

**TODOs**:
- [ ] Create CRUD endpoints for validation rules
- [ ] Link rules to surveys properly
- [ ] Support rule activation/deactivation
- [ ] Add frontend UI for rule management

**Files**:
- `backend/routers/validation_rules.py` (create or expand)
- Frontend components for rule management

**Estimated Effort**: 3-4 days

---

### 16. Audit File Management
**Location**: `CHANGES_REVIEW.md` (lines 226-228)  
**Status**: Currently keeps all files

**TODOs**:
- [ ] Add cleanup for old audit files
- [ ] Consider storing in database instead of filesystem
- [ ] Add retention policy configuration

**Files**:
- `backend/etl/audit_processor.py`

**Estimated Effort**: 1-2 days

---

### 17. Survey Management UX Improvements
**Location**: `PROGRESS.md` (lines 223-228)  
**Status**: Current flow is confusing

**TODOs**:
- [ ] Separate survey list from creation form
- [ ] Implement multi-step wizard approach (like KoboToolbox)
- [ ] Improve rule builder integration into survey setup flow
- [ ] See `SURVEY_UX_IMPROVEMENTS.md` for detailed plan (if exists)

**Files**:
- `frontend/pages/CreateSurveyPage.tsx`
- `frontend/components/rule-builder/`

**Estimated Effort**: 1-2 weeks

---

### 18. Error Handling Improvements
**Location**: `PROGRESS.md` (lines 239-242)  
**Status**: Basic error handling exists

**TODOs**:
- [ ] More granular error messages
- [ ] Better logging throughout application
- [ ] Retry strategies for API calls
- [ ] User-friendly error messages in frontend

**Estimated Effort**: 2-3 days

---

### 19. Additional Features
**Location**: `PROGRESS.md` (lines 303-306)  
**Status**: Not started

**TODOs**:
- [ ] Survey duplication functionality
- [ ] Export functionality (CSV, Excel)
- [ ] Advanced filtering/search for submissions
- [ ] Bulk operations on submissions

**Estimated Effort**: 1-2 weeks

---

### 20. Deployment Configuration
**Location**: `PROGRESS.md` (lines 144-155)  
**Status**: Not started

**TODOs**:
- [ ] GCP Cloud Run configuration
- [ ] Cloud SQL setup
- [ ] Cloud Composer (Airflow) setup
- [ ] Cloud Build CI/CD
- [ ] Environment variable management
- [ ] Monitoring and logging setup

**Estimated Effort**: 3-5 days

---

### 21. Documentation
**Location**: `PROGRESS.md` (lines 214-217)  
**Status**: Basic documentation exists

**TODOs**:
- [ ] User guide
- [ ] Complete API documentation
- [ ] Deployment guide
- [ ] Developer onboarding guide

**Estimated Effort**: 2-3 days

---

## 📋 Summary by Priority

### Today's Work (High Priority)
1. **Audit Log Processing - Performance Metrics** ✅ **COMPLETED** (2-3 hours)
   - ✅ Calculate avgActiveTime, avgTotalTime, avgDkRate from audit logs
   - ✅ Made survey_id required parameter
   - ✅ Added validation and error handling
   
2. **Form Edition Detection Fix** ✅ **COMPLETED** (3-4 hours)
   - ✅ Fixed logic for detecting edited submissions using `meta/deprecatedID`
   - ✅ Removed flawed timestamp-based comparison
   - ✅ Simplified edit detection to use Kobo's explicit indicator
   
3. **Update Kobo Link Wording and Target** (1-2 hours)
   - Change "View in kobo" to "Edit in kobo"

### This Week (Medium Priority)
4. **Testing Suite Implementation** (3-5 days)
5. **HFC Engine Expression Evaluator Security** (1-2 days)
6. **Survey Deletion Cascade** (2-3 hours)
7. **ETL Dry Run Mode** (2-3 hours)
8. **Post-Basic-Info Quality Check Prompt** ✅ (4-5 hours - completed)
9. **Dataset-Level Quality Checks** (3-5 days)
10. **Overview Dashboard** (3-5 days)
11. **Enumerator Performance Page UX** (2-3 days)

### Future Work (Low Priority)
12. **Form Validation Button** (1-2 days, if feasible)
13. **Airflow DAG Setup** (2-3 days)
14. **ETL Performance Optimization** (2-3 days)
15. **Validation Rules API** (3-4 days)
16. **Audit File Management** (1-2 days)
17. **Survey Management UX Improvements** (1-2 weeks)
18. **Error Handling Improvements** (2-3 days)
19. **Additional Features** (1-2 weeks)
20. **Deployment Configuration** (3-5 days)
21. **Documentation** (2-3 days)
22. **User System with Kobo API Key Management** (1-2 weeks)
23. **Qualitative Data Checks** (1-2 weeks)
24. **GitHub Issue #7 - Kobo Modal Auto-Open** (1-2 days)

---

## 🔍 Notes

- **Audit Log Processing**: ✅ **COMPLETED** - Metrics are calculated and aggregated correctly. Made `survey_id` required to ensure proper aggregation per survey with survey-specific configurations (enumerator field names, DK values).
- **Form Edition Detection**: ✅ **COMPLETED** - Fixed edit detection to use Kobo's `meta/deprecatedID` field. Removed flawed timestamp comparison logic. Edit detection is now reliable and based on Kobo's explicit indicators.
- **GitHub Issue #7**: Comprehensive issue created with investigation plan
- **Testing**: Manual testing is done, but automated tests are needed for production readiness
- **Security**: Expression evaluator needs to be hardened before production use
- **Performance**: Current implementation works but could be optimized for large datasets

---

*Last Updated: 2025-01-XX*


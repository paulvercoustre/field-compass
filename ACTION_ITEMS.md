# Action Items & TODOs - Field Compass

**Last Updated**: January 2025  
**Source**: Review of codebase and implementation status

---

## ✅ COMPLETED - Core Features Implemented

### 1. User Authentication System
**Status**: ✅ **COMPLETED**

**Implementation includes**:
- [x] User registration with email/username/password
- [x] JWT-based login/logout
- [x] Profile management (update username, full name)
- [x] Per-user Kobo API key management (encrypted at rest)
- [x] Password change functionality
- [x] Kobo API key testing endpoint
- [x] User account deletion
- [x] Login page UI

**Files**:
- `backend/routers/users.py` - Full user management endpoints
- `backend/services/auth.py` - JWT authentication, password hashing, encryption
- `backend/database/models.py` - User model with relationships
- `frontend/contexts/AuthContext.tsx` - Auth state management
- `frontend/pages/LoginPage.tsx` - Login/registration UI
- `frontend/pages/UserSettingsPage.tsx` - Profile settings UI

---

### 2. Validation Rules CRUD API
**Status**: ✅ **COMPLETED**

**Implementation includes**:
- [x] Create validation rules for surveys
- [x] Read validation rules (list all, get single)
- [x] Update validation rules
- [x] Delete validation rules
- [x] Permission-based access (owner only can modify)
- [x] Rule activation/deactivation

**Files**:
- `backend/routers/validation_rules.py` - Full CRUD endpoints
- `frontend/components/rule-builder/` - Rule builder UI components
- `frontend/pages/RuleBuilder.tsx` - Rule management page

---

### 3. HFC Engine Expression Evaluator Security
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] Replaced unsafe `eval()` with `simpleeval` library
- [x] Safe expression evaluation for validation rules
- [x] Tested with existing validation rules

**Files**:
- `backend/etl/hfc_engine.py` - Uses `simpleeval.SimpleEval`
- `backend/requirements.txt` - Includes `simpleeval==0.9.13`

---

### 4. Audit Log Processing - Performance Metrics
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] Calculate `avgActiveTime` from audit logs
- [x] Calculate `avgTotalTime` from audit logs
- [x] Calculate `avgDkRate` from submission data
- [x] Survey-specific enumerator field configuration
- [x] Aggregation per enumerator

**Files**:
- `backend/etl/audit_processor.py` - Audit log parsing
- `backend/routers/progress.py` - Performance data endpoint
- `frontend/pages/EnumeratorPerformancePage.tsx` - Performance UI

---

### 5. Form Edition Detection Fix
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] Uses `meta/deprecatedID` field for reliable edit detection
- [x] Removed flawed timestamp comparison logic
- [x] JSON diff calculation for history tracking

**Files**:
- `backend/etl/data_merger.py` - Edit detection logic
- `backend/etl/kobo_fetcher.py` - Kobo API integration

---

### 6. Update Kobo Link Wording and Target
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] Changed link text to "Edit in Kobo"
- [x] Backend endpoint fetches Enketo edit URL from Kobo API
- [x] Frontend dynamically loads edit URL

**Files**:
- `frontend/components/SubmissionDetail.tsx`
- `backend/routers/submissions.py` - Edit URL endpoint

---

### 7. Survey Deletion Cascade
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] Cascade delete submissions, validation rules, history
- [x] Transaction-based atomic deletion
- [x] Returns counts of deleted records

**Files**:
- `backend/routers/surveys.py` - `delete_survey()` function

---

### 8. Post-Basic-Info Quality Check Prompt
**Status**: ✅ **COMPLETED**

**Files**:
- `frontend/components/QualityCheckPromptModal.tsx`
- `frontend/pages/CreateSurveyPage.tsx`

---

### 9. CI/CD Pipeline
**Status**: ✅ **COMPLETED**

**Implementation**:
- [x] GitHub Actions workflow
- [x] Linting with ruff
- [x] Unit tests with pytest
- [x] Docker image build and push to GHCR
- [x] Integration tests in Docker
- [x] Azure deployment (when configured)

**Files**:
- `.github/workflows/ci-cd.yml`

---

### 10. Testing Suite
**Status**: ✅ **PARTIAL** (~60 test functions, ~1650 lines)

**What exists**:
- [x] ETL component tests (audit processor, data merger, HFC engine)
- [x] API endpoint tests
- [x] Validation rules tests
- [x] Fixtures and test database setup

**Files**:
- `backend/tests/` - 9 test files with comprehensive coverage

---

## 🔴 HIGH PRIORITY - Remaining Work

### 1. Data Quality Overview Dashboard (Issue #9)
**Status**: ❌ NOT STARTED

**Requirements**:
- [ ] Backend `/api/quality/overview` endpoint
- [ ] Issue frequency aggregation
- [ ] Temporal trends data
- [ ] Quality health metrics
- [ ] Frontend dashboard with charts (recharts)
- [ ] Global filters (survey, date, enumerator)

**Estimated Effort**: 1.5-2 weeks

**Files to create**:
- `backend/routers/quality.py`
- `frontend/pages/QualityOverviewPage.tsx`
- `frontend/components/quality-dashboard/*.tsx`
- `frontend/services/qualityApi.ts`

**Spec Document**: `ISSUE_9_QUALITY_DASHBOARD.md`

---

### 2. GitHub Issue #7 - Kobo Modal Auto-Open
**Status**: ❌ NEEDS INVESTIGATION

**Requirements**:
- [ ] Investigate Kobo deep linking capabilities
- [ ] Test DOM structure and modal triggering
- [ ] Implement solution if feasible

**Estimated Effort**: 1-2 days

---

## 🟡 MEDIUM PRIORITY

### 3. ETL Dry Run Mode
**Status**: ❌ NOT IMPLEMENTED (flag exists but not functional)

**Requirements**:
- [ ] Implement dry run that fetches but doesn't write to DB
- [ ] Preview statistics before commit

**Files**: `backend/scripts/run_etl.py`, `backend/etl/pipeline.py`

**Estimated Effort**: 2-3 hours

---

### 4. Dataset-Level Quality Checks
**Status**: ❌ NOT STARTED

**Requirements**:
- [ ] Aggregate quality analysis across entire dataset
- [ ] Completeness, consistency, outlier detection

**Estimated Effort**: 3-5 days

---

### 5. Enumerator Performance Page UX Improvements
**Status**: ⏳ PARTIAL (basic implementation exists)

**Requirements**:
- [ ] Add charts/graphs for visualization
- [ ] Make metrics more actionable
- [ ] Improve overall visual design

**Estimated Effort**: 2-3 days

---

### 6. Additional Frontend Tests
**Status**: ❌ NOT STARTED

**Requirements**:
- [ ] React component tests
- [ ] E2E tests (Playwright/Cypress)

**Estimated Effort**: 3-5 days

---

## 🟢 LOW PRIORITY - Nice to Have

### 7. Airflow DAG Setup
- Scheduled ETL automation (manual trigger works fine)
- Estimated: 2-3 days

### 8. ETL Performance Optimization
- Parallelization, batching for large datasets
- Estimated: 2-3 days

### 9. Audit File Management
- Cleanup for old audit files
- Retention policy
- Estimated: 1-2 days

### 10. Survey Management UX Improvements
- Multi-step wizard approach
- Better separation of list vs. creation
- Estimated: 1-2 weeks

### 11. Export Functionality
- CSV/Excel export for submissions
- Quality reports export
- Estimated: 2-3 days

### 12. Documentation
- User guide
- Complete API documentation
- Developer onboarding guide
- Estimated: 2-3 days

### 13. Qualitative Data Checks
- NLP-based quality assessment for text responses
- Estimated: 1-2 weeks (complex)

---

## 📋 Summary

| Category | Completed | Remaining |
|----------|-----------|-----------|
| User Authentication | ✅ 100% | - |
| Validation Rules API | ✅ 100% | - |
| ETL Pipeline | ✅ 100% | Dry run mode |
| CI/CD | ✅ 100% | - |
| Backend Tests | ✅ ~70% | E2E tests |
| Quality Dashboard | ❌ 0% | Full implementation |
| Frontend Tests | ❌ 0% | Component & E2E tests |

---

## 🎯 Recommended Next Steps

1. **Quality Dashboard (Issue #9)** - High impact for QA workflows
2. **Frontend Tests** - Improve confidence before production
3. **ETL Dry Run Mode** - Quick win (2-3 hours)
4. **Enumerator Performance UX** - Polish existing feature

---

*Document auto-generated from codebase review*

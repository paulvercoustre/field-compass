# Commit plan – worktree cleanup

Below are the **proposed commits** in order. For each: paths to stage and a draft commit message. You run `git commit -m "..."` after each stage; I run `git add` (and `git add -p` where needed for split files).

**Note:** The deleted file `OUTLIER_DETECTION_GUIDE.md` is left out; say if you want it in a separate commit.

**Simplified approach (no partial staging):** One “database + migrations” commit adds all new submission columns (DK, reviewer_notes, LLM) and migrations 003–005. Then one “submission API” commit adds the full Pydantic/router/api changes (reviewer notes + LLM fields). Remaining commits are per-feature. This avoids `git add -p` on mixed files.

---

## 1. Database: submission columns and migrations (003, 004, 005)

**Stage:**  
`backend/database/migrations/003_add_submission_dk_metrics.sql`  
`backend/database/migrations/004_add_reviewer_notes.sql`  
`backend/database/migrations/005_add_llm_qualitative_tracking.sql`  
`backend/database/schema.sql`  
`backend/database/models.py`  
`backend/etl/dk_utils.py`

**Message:**
```
feat(db): add submission columns and migrations (DK, reviewer notes, LLM tracking)

- Migration 003: dk_count, dk_eligible_count, dk_percentage
- Migration 004: reviewer_notes
- Migration 005: llm_check_status, llm_* hashes/timestamps/job_id/error and indexes
- schema.sql and ORM updated; dk_utils for ETL DK computation
```

---

## 2. Submission API: reviewer notes + LLM fields (Pydantic, router, frontend api)

**Stage:**  
`backend/models.py`  
`backend/routers/submissions.py`  
`frontend/services/api.ts`

**Message:**
```
feat(submissions): expose reviewer notes and LLM status in API; add PATCH reviewer-notes

- Submission: reviewer_notes, llm_* fields; ReviewerNotesUpdate; QualityMetricsSummary.avg_dk_percentage
- submissions router: map reviewer_notes + llm_*; PATCH /submissions/{id}/reviewer-notes
- frontend api.updateReviewerNotes
```

---

## 3. Progress filter (exclude REJECTED by default)

**Stage:**  
`backend/routers/progress.py`  
`backend/tests/test_api_endpoints.py`  
`frontend/pages/DataCollectionProgressPage.tsx`

**Message:**
```
feat(progress): exclude REJECTED by default; approved_only for APPROVED only

- Progress query: default excludes REJECTED; approved_only=true counts only APPROVED
- DataCollectionProgressPage default approvedOnly=false
- test_api_endpoints: cover default (exclude REJECTED) and approved_only
```

---

## 4. Quality overview DK (avg_dk_percentage)

**Stage:**  
`backend/routers/quality.py`  
`frontend/components/quality-dashboard/QualityMetricsCards.tsx`

**Message:**
```
feat(quality): add avg DK % to quality overview and metrics cards

- Quality overview computes and returns avg_dk_percentage (QualityMetricsSummary already in commit 2)
- QualityMetricsCards shows card when present
```

---

## 5. Outlier baseline test (optional)

**Stage:**  
`backend/tests/test_hfc_engine.py`

**Message:**
```
test(hfc): exclude Not Approved from outlier statistics baseline

- TestPrecomputeOutlierStatistics: baseline must not include Not Approved submissions
```

---

## 6. LLM qualitative – hashing and HFC engine

**Stage:**  
`backend/utils/__init__.py`  
`backend/utils/rule_versioning.py`  
`backend/etl/hfc_engine.py`

**Message:**
```
feat(llm): add rules/input hashing and HFC needs_llm_qualitative_check

- rule_versioning: generate_llm_rules_hash, generate_llm_input_hash, should_enqueue_llm_check
- HFC engine: compute hashes, read llm config (flag_llm_qualitative, fields, check_types), needs_llm_qualitative_check
```

---

## 7. LLM qualitative – AI service and Celery worker

**Stage:**  
`backend/services/ai_service.py`  
`backend/services/job_queue.py`  
`backend/services/qualitative_worker.py`  
`backend/services/qualitative_worker_runtime.py`  
`backend/requirements.txt`

**Message:**
```
feat(llm): Celery worker and task-specific AI models for qualitative checks

- ai_service: OPENAI_RULE_GEN_MODEL / OPENAI_QUAL_CHECK_MODEL, check_qualitative_responses()
- job_queue (Celery + Redis), qualitative_worker task, qualitative_worker_runtime (fetch, AI, merge issues, update status)
- requirements: celery, redis
```

---

## 8. LLM qualitative – ETL enqueue

**Stage:**  
`backend/etl/pipeline.py`  
`backend/routers/etl.py`

**Message:**
```
feat(etl): enqueue LLM qualitative checks from pipeline with dedup

- Pipeline: rules hash once per run, input hash per submission, needs_llm_qualitative_check, enqueue task, set submission llm state and stats (llm_queued, llm_skipped)
- ETL response and progress stats expose llm_queued / llm_skipped
```

---

## 9. LLM qualitative – frontend config

**Stage:**  
`frontend/services/progressApi.ts`  
`frontend/pages/SurveySettingsPage.tsx`

**Message:**
```
feat(settings): AI qualitative text analysis config in survey settings

- progressApi: flag_llm_qualitative, llm_qualitative_fields, llm_check_types in config and ETL stats
- SurveySettingsPage: AI Qualitative Text Analysis section (enable + field checkboxes)
```

---

## 10. LLM qualitative – frontend visibility

**Stage:**  
`frontend/types.ts`  
`frontend/components/Dashboard.tsx`  
`frontend/components/SubmissionListItem.tsx`  
`frontend/components/SubmissionDetail.tsx`

**Message:**
```
feat(ui): show LLM qualitative check status and ETL queue stats

- types: Submission llm fields; ETLStats llm_queued/llm_skipped
- Dashboard: poll when any submission pending/running; success message includes AI checks queued
- SubmissionListItem / SubmissionDetail: status chip, in progress, last checked, error
```

---

## 11. Docker – Redis and qualitative worker

**Stage:**  
`docker-compose.yml`  
`docker-compose.prod.yml`

**Message:**
```
chore(docker): add Redis and qualitative worker services

- redis service; qualitative worker (Celery) for LLM checks
```

---

## 12. LLM qualitative tests

**Stage:**  
`backend/tests/test_llm_qualitative.py`

**Message:**
```
test(llm): add tests for rules/input hashing, enqueue matrix, HFC needs-check, AI model routing
```

---

## Summary

| # | Scope |
|---|--------|
| 1 | Database: migrations 003–005, schema, ORM, dk_utils |
| 2 | Submission API: Pydantic (reviewer_notes, llm_*, avg_dk), router, frontend api |
| 3 | Progress filter (progress router + test + frontend default) |
| 4 | Quality DK (quality router + QualityMetricsCards) |
| 5 | Outlier test (test_hfc_engine) – optional |
| 6 | LLM hashing + HFC engine |
| 7 | LLM AI + Celery worker + requirements |
| 8 | LLM ETL enqueue |
| 9 | LLM frontend config (settings + progressApi) |
| 10 | LLM frontend visibility (types + Dashboard + list/detail) |
| 11 | Docker Redis + worker |
| 12 | LLM tests |

**Not in this plan:** `OUTLIER_DETECTION_GUIDE.md` (deleted). Add a separate commit for the deletion if you want it tracked.

If this order and split look good, we proceed with **Commit 1**: I’ll run the `git add`, then you run the commit.

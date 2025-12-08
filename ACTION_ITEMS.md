# Action Items & TODOs - Field Compass

**Generated**: 2025-01-XX  
**Source**: Consolidated review of markdowns + current code state

---

## 🎯 Immediate Focus (High)

1. **Audit log metrics into performance API** — Partially done  
   - Audit parsing exists (`backend/etl/audit_processor.py`), `active_interview_time` stored in submission data.  
   - Missing: aggregate `avgActiveTime`, `avgTotalTime`, `avgDkRate` per enumerator in `backend/routers/progress.py#get_performance_data`.  
   - Outcome: richer enumerator performance view.

2. **GitHub Issue #7: Kobo modal auto-open** — Not started  
   - Investigate Kobo deep links + DOM to trigger modal; implement in `frontend/components/SubmissionDetail.tsx`; test browser compatibility.

3. **Form edition detection correctness** — Not started  
   - Fix how submissions are marked “edited” so ETL can later process only new/edited submissions. Clarify source of truth (submission metadata vs audit vs delta logic).

---

## 🧭 Survey UX & Kobo Integration

4. **Post-basic-info quality-check prompt** — Not started  
   - Popup after basic survey info asking to configure data quality checks now/later; “Now” sends to survey’s quality-check form in edit mode.

5. **Update Kobo link** — Not started  
   - Change “View in kobo” → “Edit in kobo” and point to Kobo form edit page.

6. **Form validation button** — Not started / blocked on Kobo capabilities  
   - Add explicit “Validate” action leveraging Kobo’s validation UX if available.

7. **Overview dashboard + dataset-level checks** — Not started  
   - Build overview dashboard; decide placement of dataset-level checks and implement them.

8. **Enumerator performance page UX** — Not started  
   - Make the page more visual and action-oriented; incorporate new metrics once available.

9. **Qualitative data checks** — Not started  
   - Assess answer quality (is it on-topic, complete, rich) and score results.

---

## 🔒 Reliability, Safety, Testing

10. **Testing suite expansion** — 10% done (manual only)  
    - Add unit/integration tests for ETL, API, frontend; add E2E coverage.

11. **HFC expression evaluator hardening** — Not started  
    - Replace `_safe_eval` usage of `eval()` with a safe parser; re-test rules.

12. **ETL dry-run mode** — Not started  
    - Implement flag in `backend/scripts/run_etl.py` + pipeline to fetch/preview without DB writes.

13. **ETL performance optimization** — Not started  
    - Parallelize, batch commits, optimize queries; add performance monitoring.

---

## 📦 Data & Lifecycle Management

14. **Survey deletion cascade** — Not started  
    - Cascade delete submissions, history, validation rules; handle FKs; optional soft delete.

15. **Audit file management** — Not started  
    - Retention/cleanup for audit CSVs (`backend/etl/audit_processor.py`); consider DB storage.

16. **Validation rules API CRUD** — Not started  
    - Add CRUD endpoints + frontend UI; link rules to surveys; support activation toggles.

---

## 🌐 Platform & Users

17. **User system with Kobo API key management** — Not started  
    - Full user lifecycle (registration, management, deletion) and per-user Kobo API key (currently hardcoded).

18. **Deployment configuration** — Not started  
    - Cloud Run/SQL/Composer setup, CI/CD, env vars, monitoring.

19. **Documentation** — Not started (basic docs exist)  
    - User guide, API docs, deployment guide, dev onboarding.

20. **Airflow DAG setup** — Not started (lower priority; manual trigger works)  
    - Define DAG, retries, monitoring; test locally and for Composer.

---

## 📋 Time-Bound Snapshot

- **Today**: Audit metrics aggregation; Kobo modal auto-open investigation; clarify/edit-detection logic.  
- **This Week**: Testing suite build-out; HFC evaluator hardening; survey deletion cascade; ETL dry-run.  
- **Future**: Airflow DAG, ETL perf, validation rules CRUD/UI, audit retention, survey UX redesign, qualitative checks, deployment, docs, user system, overview/dashboard work.

---

## 🔍 Notes

- Audit parsing/storage is in place; missing aggregation into performance API.  
- QA/Kobo edit links already exist; wording/target still needs change.  
- Many items remain at “not started”; testing and safety work should precede UX polish.  
- Form edit-detection fix will help narrow ETL processing scope later.  

*Last Updated: 2025-01-XX*


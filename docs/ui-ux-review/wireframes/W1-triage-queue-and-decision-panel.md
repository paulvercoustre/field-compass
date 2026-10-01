# W1 — Triage queue + decision panel (F-01, F-02, F-03, F-04)

Replaces the Submissions view's left list and the top of the detail pane. Everything below the
"Why flagged" block (overview, full check lists, answers) stays as it is today.

## Desktop ≥ 1024 px

```
┌ Household Resilience 2026 ─────────────────────────────── Submissions · Data Quality · Progress · Field team · Settings ┐
│ Submissions                               Last pulled from Kobo 14:32 (12 min ago)   [↻ Pull new submissions]        │
├──────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┤
│ ┌Needs review 46┐ Reviewed 51  All 147│  #300246 · enum_07 Nadia Rahimi · Eastern · 28 Sep            3 of 46 ‹  ›     │
│ └───────────────┘                    │ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ Issue: [ Any issue            ▾]     │ │ WHY FLAGGED (2)                                                             │ │
│ Enumerator: [ All ▾]  District:[All▾]│ │ ● Duration too short — active 6 min, minimum is 15 min                      │ │
│ Sort: [ Most issues first ▾]         │ │ ● Outlier: monthly income — 95 000 (expected 1 200 – 7 800)                │ │
│ ──────────────────────────────────── │ │                                                     Jump to details ↓      │ │
│ ▸ #300246  enum_07 · Eastern      ⚠2 │ └────────────────────────────────────────────────────────────────────────────┘ │
│   Duration too short · Outlier …     │  Decision                                                                      │
│   28 Sep 15:52          Not reviewed │  [ ✓ Approve  A ]  [ ✕ Not approved  N ]  [ ⏸ On hold  H ]   Note (optional) ▢ │
│ ──────────────────────────────────── │  "Approve" with open issues asks for a one-line reason in the note field.     │
│   #300243  enum_04 · Western      ⚠1 │  After a decision → next item in this list loads automatically (toggle ☑).    │
│   AI: answer not meaningful          │ ─────────────────────────────────────────────────────────────────────────────  │
│   28 Sep 14:46          Not reviewed │  Submission overview · General checks 6/7 · Custom 3/3 · AI 1 · Answers ▾     │
│   …                                  │  (existing content, unchanged, collapsed sections for passed checks)          │
│ Showing 46 of 147 · J/K to move      │                                                                                │
└──────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┘
```

### Behaviour

| Element | Behaviour | Copy |
|---|---|---|
| Queue tabs | Segmented control above the list. **Needs review** = `qa_status=FLAGGED` — already supported end to end (`FilterState.qaStatuses` → `buildFilterParams` → `GET /api/submissions?qa_status=FLAGGED`, `backend/routers/submissions.py:171`; FLAGGED means "has issues, not approved or rejected", `hfc_engine.py:1611`), so the first version needs **no backend change**. Caveats measured on the review dataset: (1) "On Hold" keeps the previous qa_status, so held items stay in Needs review — add `&validation_status=Not Reviewed` to exclude them; (2) the AI worker never recomputes `qa_status`, so submissions whose **only** issues are AI findings stay `PENDING_APPROVAL` and would be missed (3 of 44 here: #300130, #300135, #300152). v1 can ship on `qa_status=FLAGGED`; v2 should either have `qualitative_worker_runtime.py` recompute qa_status after writing findings, or add a backend `has_issues=true` filter (`jsonb_array_length(data_quality_issues) > 0`). **Reviewed** = any validation status. **All**. Counts come from the list response `total`. Default tab = Needs review when it is non-empty. | "Needs review 46", "Reviewed 51", "All 147" |
| Issue filter | Single-select listing each check that fired, with counts, human labels (see F-12 copy table). Selecting sets `issue_check=<id>` query param (backend: `data_quality_issues @> '[{"check": "<id>"}]'`). Same filter is what Data Quality bars link to (F-09). | "Any issue", "Duration too short (36)", "AI: answer not meaningful (17)" … |
| Sort | Most issues first (default in Needs review) · Newest first (default in All) · Oldest first | |
| Row | 2 lines + meta: `#id  enumerator label · district  ⚠n` / first two issue labels, truncated / date + status pill. Row height ≤ 72 px (fits 9–10 rows at 900 px). | |
| Decision bar | Three buttons, always visible under "Why flagged"; keyboard **A / N / H** when focus is not in a text field; **J / K** or **↓ / ↑** move within the list. | |
| Auto-advance | After a successful status change, the item leaves "Needs review" (optimistic update) and the next item opens. Toggle persisted per user in localStorage. | Toast: "Approved #300246 · Undo" (8 s, keyboard reachable) |
| Approve with open issues | Not blocked (expert speed), but the note field gets focus with placeholder "Why approve despite 2 issues?" — Enter saves note + approves. | |
| Position | "3 of 46" with ‹ › buttons. | |

## Narrow (< 1024 px, incl. 200 % zoom on laptops)

```
┌ Submissions ───────────── [↻] ┐        ┌ ‹ Back to queue      3 of 46  › ┐
│ [Needs review 46][Reviewed][All]│  tap  │ #300246 · enum_07 · Eastern     │
│ Issue: [Any ▾]  Sort: [Most ▾]  │ ────▶ │ WHY FLAGGED (2)                 │
│ ▸ #300246 enum_07 · Eastern ⚠2  │       │ ● Duration too short — 6 < 15   │
│   Duration too short · Outlier  │       │ ● Outlier: income 95 000        │
│ ▸ #300243 enum_04 · Western ⚠1  │       │ [Approve] [Not approved] [Hold] │
└─────────────────────────────────┘       │ … details …                     │
                                          └─────────────────────────────────┘
```
List and detail become two stacked routes (`/surveys/:id/submissions` and `/surveys/:id/submissions/:subId`, see F-32) instead of `hidden md:block`.

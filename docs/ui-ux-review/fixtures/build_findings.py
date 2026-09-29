"""
Single source for the findings catalog.

    python build_findings.py   ->  ../findings.json  and  ../_catalog.md (pasted into REPORT.md §7)

Evidence tags: [OBSERVED] seen in the running app (local stack, synthetic data, mocked Kobo/OpenAI);
[CODE] read in source at commit 2e4d096; [INFERRED] reasoned, not seen.
Screenshots are relative to docs/ui-ux-review/screenshots/.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

T1 = "T1 The review loop is not built around the flagged queue"
T2 = "T2 Numbers that invite wrong decisions"
T3 = "T3 Silent failures and invisible feedback"
T4 = "T4 Setup and configuration friction"
T5 = "T5 Accessibility and adaptable layout"
T6 = "T6 Missing foundations (URLs, tokens, shared components)"
T7 = "T7 Permissions and session"


def opt(oid, change, effort, risks, unlocks):
    return {"id": oid, "change": change, "effort": effort, "risks": risks, "unlocks": unlocks}


F = []

F.append(dict(
    id="F-01", theme=T1, priority="Now", severity=3, scope="Local", type="Workflow",
    title="Flagged submissions cannot be isolated in the review queue",
    where=["S1 Submissions — components/SubmissionFilters.tsx:369-420 (only Validation status, Enumerator, Sampling filters)",
           "components/Dashboard.tsx:304 (list column, no sort control)"],
    evidence=["[OBSERVED] 147 submissions, 67 with issues, 44 needing review, scattered at list positions 1…144; 7 rows visible per 900 px screen (row height 93 px). Filters offered: Validation Status / Enumerator / district (j4.json; screenshots j4-01-queue.png, j4-02-filters-open.png).",
              "[CODE] Backend already supports `qa_status=FLAGGED` (backend/routers/submissions.py:171) and the frontend already serialises `FilterState.qaStatuses` (utils/filterUtils.ts:94-103) — but no control sets it.",
              "[OBSERVED] No way to filter by issue type; Data Quality's issue bars cannot drill down either (see F-09)."],
    who="Data-quality officer / field supervisor doing daily review", journeys=["J4", "J5"],
    why="Triage starts from 'what needs my attention'. Today the reviewer scans 147 rows to find 44, every day, and cannot work one issue type at a time. Heuristics: recognition over recall; flexibility and efficiency of use.",
    options=[
        opt("A", "Add a 'Needs review · Reviewed · All' segmented control above the list; Needs review sets qaStatuses=[FLAGGED] (+ validation_status=Not Reviewed). Default to Needs review when non-empty. Add Sort (Most issues first / Newest / Oldest).", "S (frontend only, ~1 day)", "Misses AI-only issues until the worker recomputes qa_status (3 of 44 in this dataset); On Hold semantics need a decision.", "Makes F-03 auto-advance meaningful; gives Data Quality a target for drill-downs."),
        opt("B", "A + an 'Issue' single-select filter listing checks that fired, with counts and human labels; backend `issue_check` param on /api/submissions (jsonb containment).", "M (frontend + ~20 lines backend)", "Needs label dictionary (F-12).", "Unblocks F-09 drill-down and per-issue batch review."),
        opt("C", "Separate 'Review inbox' page listing only flagged items with batch actions.", "L", "Duplicates the Submissions page; two places to decide.", "Batch approve."),
    ],
    recommendation="A now, B next. A is almost free because the backend filter already exists; B is the shared foundation for F-09. C adds a second place to take the same decision.",
    success="From opening Submissions to the first flagged, unreviewed submission in ≤ 1 click (today: scan up to 144 rows). 'Needs review' count matches the Data Quality 'needs review' figure.",
    confidence="High", validate_with="", effort="S→M",
))

F.append(dict(
    id="F-02", theme=T1, priority="Now", severity=3, scope="Local", type="IA/Navigation",
    title="The reason a submission was flagged is below the fold and not named next to the decision",
    where=["S1 detail — components/SubmissionDetail.tsx:461-519 (action row + generic warning)",
           "SubmissionDetail.tsx:49-65 (checks rendered in definition order, passes first)",
           "SubmissionDetail.tsx:651-1244 (General → Custom → Qualitative → Outlier sections)"],
    evidence=["[OBSERVED] Detail content 2 125 px in a 606 px pane (3.5 screens); first 'Flagged' marker 856 px from the top, i.e. not visible without scrolling (j4.json; j4-03-detail-top.png).",
              "[OBSERVED] Header says '1 issue' and 'Review 1 quality issue below before validation' but never which one; the first things below are green 'Missing UUID — Passed', 'Missing Enumerator — Passed', 'Date Out Of Range — Passed' (state-detail-300193.png).",
              "[CODE] Approving a flagged submission shows a warning only after the fact (SubmissionDetail.tsx:508-512)."],
    who="Reviewer", journeys=["J4"],
    why="The decision (approve / not approved / hold) depends entirely on why the item was flagged. Making the reviewer scroll past passed checks to find it costs time on every item and makes it easy to approve without reading. Heuristics: visibility of system status; recognition over recall; aesthetic and minimalist design (passes are noise at decision time).",
    options=[
        opt("A", "Order every check list failures-first and collapse passed checks into one line per section ('6 passed ▸').", "S", "Still below the overview and notes (~300 px down).", "—"),
        opt("B", "Add a 'Why flagged (n)' block directly under the header, above the overview: one line per issue with label, value and threshold ('Duration too short — active 6 min, minimum 15 min'), each linking to its detail card. Keep A for the sections below.", "S–M", "Must derive a one-line summary per check type (most already have `message`).", "Enables keyboard-only review with F-03 shortcuts."),
        opt("C", "Move the whole check area to a right-hand column next to the answers.", "M", "Cramped under 1 280 px; conflicts with F-05 narrow layout.", "—"),
    ],
    recommendation="B (includes A). It puts the evidence and the decision in one glance without redesigning the page (wireframe W1).",
    success="On a flagged submission at 1440×900, every issue's name and value is visible without scrolling, next to the status control.",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-03", theme=T1, priority="Now", severity=3, scope="Local", type="Interaction",
    title="After a decision the reviewer stays put, and the filtered queue goes stale",
    where=["components/Dashboard.tsx:217-222 (handleSubmissionUpdate only patches the item)", "components/ValidationStatusDropdown.tsx:90-95"],
    evidence=["[OBSERVED] After 'Approve', the detail still shows the same submission; moving on requires finding the next flagged row by hand (j4-06-after-approve.png).",
              "[OBSERVED] With the list filtered to 'Not Reviewed', putting #300240 On Hold left it in the list and the count stayed 'Showing 99 submissions' (j4-10-onhold-in-not-reviewed.png).",
              "[OBSERVED] ↓ after using the menu moves to the next *list* item (not the next flagged one) — the only keyboard shortcut."],
    who="Reviewer", journeys=["J4"],
    why="Each decision costs 3 clicks + a scan. With 44 items that is ~130 clicks and 44 scans per session, and the stale list makes 'am I done?' unanswerable. Heuristics: efficiency of use; match between list state and reality.",
    options=[
        opt("A", "After a successful status change: remove the item from a list whose filter it no longer matches (optimistic), open the next item, show an 8 s 'Approved #300246 · Undo' toast (role=status).", "S", "Accidental advance; mitigated by Undo and a per-user toggle.", "Pairs with F-01 Needs review."),
        opt("B", "A + keyboard shortcuts A / N / H to decide and J / K to move, active only while focus is in the queue or detail, with a 'Keyboard shortcuts' toggle (WCAG 2.1.4).", "S", "Shortcut collisions with browser/AT if not scoped.", "Fast expert review."),
        opt("C", "Batch selection with bulk approve.", "M", "Encourages approving flagged items unread.", "—"),
    ],
    recommendation="A + B. Keep auto-advance as a toggle defaulting on (Undo covers mistakes); do not add bulk approve for flagged items.",
    success="Median interactions per decision on flagged items ≤ 2 (today 3 clicks + scan); list count updates within 1 s of a decision.",
    confidence="Med", validate_with="Watch 3 reviewers do 15 decisions each with auto-advance on vs off; count re-opens/undos.", effort="S",
))

F.append(dict(
    id="F-04", theme=T1, priority="Next", severity=2, scope="Local", type="Visual",
    title="Queue rows show the ID and time but not who, where, or what is wrong",
    where=["components/SubmissionListItem.tsx:26-40"],
    evidence=["[OBSERVED] Row = 'ID: 300246 · Not Reviewed · Submitted: 9/28/2026, 3:52:02 PM · ⚠ 1 Issues' in a 237 px column; row height 93 px → 7 rows visible (j4-01-queue.png).",
              "[OBSERVED] '1 Issues' (plural bug); issue text colour #ca8a04 on #f3f4f6 = 2.66:1 and 2.37:1 when selected (audit.json)."],
    who="Reviewer, supervisor", journeys=["J4", "J6"],
    why="Reviewers recognise work by enumerator and place ('Nadia's Eastern interviews'), and triage by issue type. Heuristics: recognition over recall; aesthetic and minimalist design.",
    options=[
        opt("A", "Row = line 1 `#id · enumerator label · district · ⚠n`, line 2 = first two issue labels, line 3 = date + status pill; max 72 px; fix plural; amber-700 text (4.56:1).", "S", "Longer text in a narrow column truncates.", "—"),
        opt("B", "A + widen the list to 320 px at ≥1 280 px.", "S", "Less room for detail.", "—"),
    ],
    recommendation="A (+B if the detail pane stays ≥ 800 px).", success="9+ rows visible at 1440×900; a reviewer can say which enumerator a row belongs to without opening it.",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-05", theme=T5, priority="Next", severity=3, scope="Systemic", type="Accessibility",
    title="Below 768 px — including 200 % zoom on a laptop — selecting a submission shows nothing",
    where=["components/Dashboard.tsx:330 (`hidden md:block`)", "components/Sidebar.tsx (fixed 256 px at every width)", "App.tsx:198-219 (nav wraps)"],
    evidence=["[OBSERVED] At 720×450 CSS px (1440×900 at 200 % zoom) and at 390/320 px the detail never appears after selecting (kbd.json reflow_*; reflow-zoom200-after-select.png, reflow-w390-queue.png).",
              "[OBSERVED] At 320 px the document is 472 px wide (horizontal scroll) and the sidebar leaves 64 px for content; at 200 % zoom the active nav tab is clipped."],
    who="Low-vision reviewers using zoom; supervisors on tablets or phones in the field", journeys=["J4", "J7"],
    why="WCAG 1.4.4 Resize text and 1.4.10 Reflow fail on the core task. Field supervisors in low-connectivity settings often have only a phone or tablet.",
    options=[
        opt("A", "Under md: list and detail become two stacked views with a Back button (state-based, no router needed); sidebar collapses to an overlay drawer below lg.", "M", "Two layouts to test.", "—"),
        opt("B", "Same as A but as routes (depends on F-32).", "M (after F-32)", "Blocked on router work.", "Deep links, browser Back."),
    ],
    recommendation="A now-ish (Next), migrate to B when F-32 lands.", success="At 320 px and at 200 % zoom a reviewer can open a submission, read why it is flagged and decide, with no horizontal scroll.",
    confidence="High", validate_with="", effort="M",
))

F.append(dict(
    id="F-06", theme=T1, priority="Later", severity=2, scope="Local", type="Feature-gap",
    title="An 'Edited' badge appears but the edit history cannot be viewed",
    where=["components/SubmissionDetail.tsx:445-450", "components/HistoryViewer.tsx (no importers)", "services/api.ts getSubmissionHistory (unused)"],
    evidence=["[CODE] HistoryViewer and api.getSubmissionHistory exist but nothing renders them (grep: no importers)."],
    who="Reviewer investigating suspected data fabrication", journeys=["J4"],
    why="An edited submission is exactly the one a reviewer wants to compare before/after. Heuristic: visibility; help users diagnose.",
    options=[opt("A", "Make 'Edited' a button that expands the existing HistoryViewer inline.", "S", "Raw JSON-patch paths are unreadable; needs label mapping.", "—"),
             opt("B", "A + render changes as 'Question: old → new' using question labels.", "M", "—", "—")],
    recommendation="B (A is a 1-hour stopgap).", success="From an edited submission, the reviewer sees what changed in ≤ 1 click.",
    confidence="Med", validate_with="Ask reviewers how often edited submissions matter in their workflow.", effort="S–M",
))

F.append(dict(
    id="F-07", theme=T1, priority="Later", severity=2, scope="Local", type="Perceived-performance",
    title="Every submission click makes a live Kobo call; when it fails the 'Edit in Kobo' button silently disappears",
    where=["components/SubmissionDetail.tsx:175-196, 466-487", "backend/routers/submissions.py:336-405 (Kobo enketo call with 3 retries, 1 s + 2 s back-off)"],
    evidence=["[OBSERVED] 'Loading…' pill on every selection (j4-03-detail-top.png); when the call failed (mock gap, then as viewer: 403) the button vanished with no message (j9 log).",
              "[CODE] KoboFetcher._make_request retries 3× with exponential back-off, so a slow Kobo adds ≥ 3 s per click."],
    who="Reviewer", journeys=["J4"],
    why="Adds latency to every item and hides a capability without explanation. Heuristic: visibility of system status.",
    options=[opt("A", "Fetch the Enketo URL on click of 'Edit in Kobo' (open a new tab to a small redirect endpoint); show an error toast if it fails.", "S", "One extra hop when editing.", "—"),
             opt("B", "Link to the Kobo data table URL already stored as `kobo_edit_url` (seen in DB) without Enketo.", "S", "Lands on the table, not the edit form.", "—")],
    recommendation="A.", success="Zero Kobo calls on selection; a failed edit link shows a message.", confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-08", theme=T2, priority="Now", severity=4, scope="Local", type="Content",
    title="Field Team ranks enumerators by review progress while labelling it data quality",
    where=["components/progress-tracker/PerformanceDataView.tsx:12-13 (definitions)", "backend/routers/progress.py:576-581 (validated = qa_status APPROVED)",
           "components/progress-tracker/EnumeratorSummaryCards.tsx:20-26, 74, 88 ('approval rate', 'Top Performer')",
           "components/progress-tracker/SubmissionsBarChart.tsx:38-42, EnumeratorLeaderboard.tsx:49-51"],
    evidence=["[CODE] 'Validated' is counted when `qa_status == 'APPROVED'` — a reviewer approved it in Kobo — but the ⓘ says 'The number of surveys with no issues found.'",
              "[OBSERVED] 'Team Validated 24.5 % approval rate' = 36 approved / 147 (Data Quality shows Approved 36, 24.5 %). With 67 % unreviewed, every bar is red '<60 % validated' (j6-01-field-team.png).",
              "[OBSERVED] enum_07 — every interview 6–9 minutes, 32/32 flagged — is #3 in 'Top 5 Performers' by 'Validation Rate' (j567.json).",
              "[CODE] Leaderboard 'Active Time' ranks the longest as top 'for simplicity… most thorough' (EnumeratorLeaderboard.tsx:49-51).",
              "[CODE] The marketing site promises: 'Compare interview duration, flag rates and output per enumerator, so retraining goes to the people who actually need it' (site/index.html). The page shows no flag rate at all."],
    who="Field coordinator / project manager deciding whom to retrain, warn or praise", journeys=["J6"],
    why="People decisions (feedback, retraining, contract renewal) are made from this page. It currently rewards enumerators whose work happened to be reviewed first and can put the worst enumerator on the podium. Heuristics: match between system and real world; error prevention.",
    options=[
        opt("A", "Now: fix the words and colours only — rename 'Validated' → 'Approved by reviewer', 'Needs review' → 'Flagged, not yet approved', ⓘ texts to the real definitions; stop colour-coding approval rate; remove 'Top performer' card and medals; change the 'Active Time' leaderboard to show no winner.", "S (copy + CSS)", "Page still has no real quality ranking.", "Stops the harm immediately."),
        opt("B", "Next: add Flag rate (≥1 issue / total, independent of review), Top issue, Median active minutes and DK rate per enumerator; sort 'Who to follow up with' by flag rate with a minimum-N rule; keep Approved as a grey progress column (wireframe W2).", "M (backend loop already computes most inputs)", "Needs agreement on which signals matter.", "A defensible follow-up list."),
        opt("C", "Remove the Field Team page until B exists.", "S", "Loses the working drill-down to an enumerator's submissions.", "—"),
    ],
    recommendation="A now, B next. C throws away a working drill-down.",
    success="Enumerators with 100 % flagged submissions never appear above ones with 0 %; every metric's ⓘ text matches its computation (spot-check 3 metrics against the API).",
    confidence="High", validate_with="Confirm with the owner which enumerator signals field coordinators act on (Q5).", effort="S→M",
))

F.append(dict(
    id="F-09", theme=T2, priority="Now", severity=3, scope="Local", type="Interaction",
    title="Issue-frequency bars promise 'click to filter' but open the unfiltered list, labelled with raw check IDs",
    where=["pages/QualityOverviewPage.tsx:35-41 (TODO, navigates without a filter)", "components/quality-dashboard/IssueFrequencyChart.tsx:62-69 (Y-axis width 150), 102-106 (hint text)"],
    evidence=["[OBSERVED] Clicking the top bar ('duration_too_short') opened Submissions with 'Showing 147 submissions' and no filter badge (j5.json; j5-02-after-issue-bar-click.png).",
              "[OBSERVED] Labels are check IDs ('qual_content_quality', 'outlier_livestock_count') and the fifth is truncated to 'erview_out_of_office_hours' (j5-01-data-quality.png)."],
    who="Data manager", journeys=["J5"],
    why="The page tells the user an action exists, then silently doesn't do it — the user may believe they are looking at the filtered set. Heuristics: consistency; error prevention; match with real-world language.",
    options=[
        opt("A", "Now: remove the hint and pointer cursor until drill-down exists; show human labels (F-12 dictionary) with full text in a wider axis or wrapped labels.", "S", "Loses a promised (but broken) path.", "—"),
        opt("B", "Next: wire bars to the issue filter from F-01 option B (Submissions opens on 'Needs review', Issue = that check).", "S after F-01B", "Depends on backend issue filter.", "Dashboard → evidence in one click."),
    ],
    recommendation="A immediately (hours), B as soon as F-01B exists.",
    success="Bar click → list count equals that bar's affected-submissions count.", confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-10", theme=T2, priority="Next", severity=3, scope="Systemic", type="Content",
    title="The same quantity is counted differently on different screens, without explanation",
    where=["Dashboard.tsx:194-196 ('flagged' = qa_status FLAGGED among re-checked)", "backend/routers/progress.py:262-265 (progress excludes Not Approved)",
           "services/qualitative_worker_runtime.py (AI findings never update qa_status)", "components/linter/FormLintPanel.tsx:273-277 vs CreateSurveyPage.tsx:615"],
    evidence=["[OBSERVED] Pull banner said '43 flagged' while 67 submissions carried issues; a later pull said '1 flagged' (only re-checked items) (j8.json; API run log).",
              "[OBSERVED] Progress 'Interviews conducted 137' vs 147 everywhere else — Not Approved are silently excluded (j567.json; progress.py:262-265).",
              "[OBSERVED] 3 submissions whose only issues are AI findings stay 'pending approval' and are invisible to any FLAGGED-based count (DB query).",
              "[OBSERVED] Create page: 'Household Resilience… (18 questions)'; form check: 'across 14 questions' (j2.json)."],
    who="Data manager reporting to donors / project leads", journeys=["J3", "J5", "J7"],
    why="When two screens disagree, users stop trusting both, or report the wrong number upward. Heuristics: consistency and standards; visibility.",
    options=[
        opt("A", "Define four named counts once (Pulled, With issues, Needs review, Approved) in a shared glossary and use them verbatim on every screen; add one-line footnotes where a view excludes something ('Excludes 10 Not approved').", "S–M", "Copy work across 6 screens.", "—"),
        opt("B", "A + have the AI worker recompute qa_status after writing findings so 'Needs review' includes AI-only issues.", "S backend", "Changes Data Quality numbers retroactively.", "Consistent Needs-review everywhere."),
    ],
    recommendation="A + B.", success="For one survey, the 'Needs review' number is identical on the pull banner, the queue tab, Data Quality and Field Team.",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-11", theme=T2, priority="Next", severity=2, scope="Systemic", type="Content",
    title="Enumerators appear as codes, and missing-enumerator submissions become a phantom 'Unknown' enumerator",
    where=["backend/routers/progress.py:573-574", "components/progress-tracker/* (renders `id`)", "SubmissionDetail.tsx:271-277", "SubmissionFilters.tsx:384-395"],
    evidence=["[OBSERVED] Field Team, filters and submission detail show 'enum_07'; the form's choice label is 'Nadia Rahimi' (j6-01-field-team.png; fixtures/mock_services.py FORM).",
              "[OBSERVED] 4 submissions with no enumerator form an 'Unknown' row counted in 'Enumerators 9 active' and top the '% Needs Review' sort (j567.json).",
              "[CODE] Commit fe7d552 removed the phantom-enumerator problem for *unconfigured* surveys ('worse than empty, because it reads as data'); it persists for configured surveys with blank values."],
    who="Field coordinator", journeys=["J6", "J4"],
    why="Coordinators think in names; codes force a lookup sheet. A phantom enumerator inflates team size and ranks. Heuristic: match with the real world.",
    options=[opt("A", "Show choice labels (existing getChoiceLabel) with the code as secondary text wherever an enumerator is shown; move blanks to a separate 'No enumerator recorded (4)' link.", "S", "Free-text enumerator fields have no label (show value as-is).", "—"),
             opt("B", "Allow the owner to upload a roster (code → name, team) in settings.", "M", "Another thing to maintain.", "Team-level views.")],
    recommendation="A.", success="No screen shows a bare enumerator code when the form has a label; 'Enumerators' count excludes blanks.",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-12", theme=T2, priority="Next", severity=2, scope="Systemic", type="Content",
    title="Pipeline and check jargon ('ETL', check IDs, 'DK', 'HFC') is shown to field staff",
    where=["Dashboard.tsx:195, 277 ('ETL completed', 'Running ETL…')", "IssueFrequencyChart.tsx (check IDs)", "IssueTimeSeriesChart.tsx", "QualityMetricsCards.tsx:50 ('Avg DK % / Submission')", "PerformanceDataView.tsx:20 ('cleaning log issues')"],
    evidence=["[OBSERVED] 'ETL completed: 147 fetched, 0 created, 147 updated, 147 checked, 43 flagged, 147 AI qualitative checks queued' (j2-07-etl-done.png).",
              "[OBSERVED] Issue names 'duration_too_short', 'qual_content_quality', 'outlier_monthly_income' in charts and legends."],
    who="Supervisors and reviewers who are survey experts, not data engineers", journeys=["J2", "J3", "J5"],
    why="Heuristic: match between system and the real world. Commit 30f4ac0 ('Say less') shows the owner already prefers plain, short copy.",
    options=[opt("A", "One label dictionary (check id → short label → one-sentence explanation) used by charts, filters, detail and banners; 'Pull new submissions' instead of 'Refresh from Kobo'; banner copy per W5.", "S", "Dictionary must be maintained when checks are added (put it next to the check registry).", "F-01B, F-09"),
             opt("B", "Serve labels from the backend with each issue.", "M", "Backend change.", "Consistent labels in exports.")],
    recommendation="A; move to B when exports exist.", success="No raw check id or 'ETL' visible in the UI (grep of rendered text).",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-13", theme=T3, priority="Now", severity=4, scope="Systemic", type="Feedback/States",
    title="Failed or partial pulls from Kobo are reported as success",
    where=["backend/etl/kobo_fetcher.py:140-142 (exception → break → empty list)", "Dashboard.tsx:194-196, QualityOverviewDashboard.tsx:96-98, DataCollectionProgressPage.tsx:65-67, EnumeratorPerformancePage.tsx:63-69 (banners omit `errors`)",
           "backend/etl/pipeline.py:282 vs 346 (flagged counted before a per-submission crash)", "backend/utils/rule_versioning.py:93"],
    evidence=["[OBSERVED] Kobo unreachable → after 3.5 s a green 'ETL completed: 0 fetched, 0 created, 0 updated, 0 checked, 0 flagged' on Submissions and Data Quality (j3.json; j3-01-refresh-kobo-down.png).",
              "[OBSERVED] With AI checks on and don't-know codes stored as a list (the shape the UI now writes), 146/147 submissions raised `AttributeError: 'list' object has no attribute 'lower'` (rule_versioning.py:93) and were rolled back; the API returned errors=146 and the UI showed a green '…43 flagged' while only 5 submissions actually carried issues (backend.log; DB query).",
              "[CODE] None of the four banner builders read `errors`."],
    who="Everyone who pulls data; especially reviewers deciding 'no new problems today'", journeys=["J3", "J8"],
    why="'0 fetched' reads as 'nothing new'; '43 flagged' reads as 'the checks ran'. Both are false. Wrong decisions follow: fieldwork continues unchecked, data is reported clean. Heuristics: visibility of system status; help users recognise and recover from errors.",
    options=[
        opt("A", "Frontend: one shared PullStatus component (W5) that shows amber when `errors > 0` or when fetched == 0 and the backend reports an upstream error; plain-language copy with Try again / Check connection.", "S", "Needs backend to report upstream failure distinctly.", "F-14 freshness strip."),
        opt("B", "Backend: kobo_fetcher raises (or returns partial + error flag) instead of silently breaking; pipeline returns `upstream_error`; fix the list/str bug in generate_llm_input_hash and isolate LLM-queue errors from deterministic results.", "S–M", "Partial pagination behaviour must be kept (partial data is still useful).", "Trustworthy counts."),
    ],
    recommendation="A + B together; B's DK bug is a data-loss defect and should ship first (suggested as a separate task — see §10).",
    success="With Kobo stopped, pressing Pull shows an amber 'Couldn't reach Kobo… nothing was updated' within 5 s; an ETL with errors > 0 never renders green.",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-14", theme=T3, priority="Next", severity=3, scope="Systemic", type="Feedback/States",
    title="There is no indication of how fresh the data is",
    where=["Dashboard.tsx:264-268 ('Last run: 3.0s' = duration)", "backend: no persisted last-pull time (grep: none)"],
    evidence=["[OBSERVED] On arrival no page shows when data was last pulled; after a pull, '✓ Last run: 3.0s' shows the pull's duration and disappears on navigation (j3.json).",
              "[CODE] README 'Next steps' lists an Airflow scheduler: pulls are manual only."],
    who="Reviewers and managers", journeys=["J3", "J4", "J7"],
    why="With manual pulls, the age of the data is the first thing a reviewer needs ('did the evening uploads come in?'). Heuristic: visibility of system status.",
    options=[opt("A", "Persist last successful pull time + counts per survey; show 'Last pulled 14:32 · 12 min ago' in a shared header strip on all four data pages (W5).", "S–M", "Schema change.", "Scheduled pulls later."),
             opt("B", "A + scheduled pulls (e.g. hourly) with the strip showing 'Next pull 15:00'.", "M–L", "Kobo rate limits; background worker ops.", "Removes a daily manual step.")],
    recommendation="A next; B when the scheduler is built.", success="Every data page answers 'how old is this?' without interaction.",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-15", theme=T3, priority="Now", severity=3, scope="Systemic", type="Feedback/States",
    title="Save confirmations in Survey Settings are wiped instantly, and errors vanish after 5 seconds",
    where=["pages/SurveySettingsPage.tsx:286-292 (loadSurveyConfig clears success)", "…:683-836 (every section save → setSuccess → loadSurveyConfig)",
           "components/ui/ErrorMessage.tsx:17 (autoHide = true by default)", "SurveySettingsPage.tsx:1042-1050 (messages rendered at page top)", "SurveySettingsPage.tsx:854 + App.tsx:32-55 (delete success hidden by the survey gate)"],
    evidence=["[OBSERVED] After saving the Outlier section, no success message exists anywhere on the page (boundingBox null; j8-03-after-outlier-save.png).",
              "[OBSERVED] Sharing with an unknown email: error shown at the page top, gone after 5 s (j9.json).",
              "[OBSERVED] After deleting a survey: 'No survey selected — Please select a survey from the sidebar to view its settings.' and no confirmation (leads.js)."],
    who="Survey owners configuring checks", journeys=["J8", "J9"],
    why="Users cannot tell whether a change took effect, so they re-save, re-check or doubt the configuration. Timed-out errors are missed entirely by anyone who looked away or uses a screen magnifier. Heuristic: visibility of system status; WCAG 2.2.1 spirit.",
    options=[opt("A", "Don't clear success in loadSurveyConfig; render confirmations/errors inside the saved section (role=status / role=alert); make ErrorMessage autoHide default false.", "S", "Messages accumulate unless cleared on next edit.", "—"),
             opt("B", "A + a toast region shared app-wide.", "S–M", "Toasts are easy to miss for magnifier users unless persistent.", "Consistency.")],
    recommendation="A (part of W4).", success="After any section save, 'Saved hh:mm' is visible in that section until the next edit; no error disappears on a timer.",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-16", theme=T3, priority="Next", severity=2, scope="Local", type="Feedback/States",
    title="A failed pull replaces the submission list with an error message",
    where=["components/Dashboard.tsx:318-319"],
    evidence=["[OBSERVED] As a viewer, pressing Refresh replaced the 147-row list with 'ETL pipeline failed: 403: This action requires editor access or higher' (j9-06-viewer-refresh.png)."],
    who="Anyone whose pull fails", journeys=["J3", "J9"],
    why="A failed pull does not invalidate the data already on screen; hiding it blocks work. Heuristic: error recovery.",
    options=[opt("A", "Split state: `listError` (the list could not load) renders in the list column; `pullError` (the refresh failed) renders only in the header banner (W5). The list stays usable.", "XS", "None significant.", "W5 PullStatus."),
             opt("B", "Keep the list but dim it with an overlay 'Couldn't refresh — showing data from 14:32 · Retry'.", "S", "Overlay blocks interaction until dismissed; worse for keyboard users.", "—")],
    recommendation="A. The data on screen is still valid; nothing should cover it.", success="After any failed pull the previous list remains visible and usable.",
    confidence="High", validate_with="", effort="XS",
))

F.append(dict(
    id="F-17", theme=T3, priority="Later", severity=2, scope="Local", type="Feedback/States",
    title="An AI check that never finishes shows 'in progress' forever and keeps the queue polling",
    where=["components/Dashboard.tsx:156-169 (8 s polling while any pending/running)", "SubmissionDetail.tsx:958-969 ('Status: skipped' shown when AI is off)"],
    evidence=["[OBSERVED] After a lost job, all 147 submissions stayed 'pending' across further pulls (dedupe skipped them); the queue would poll every 8 s indefinitely (DB + code). Triggered here by the review environment's eager-mode setup, not by production code — likelihood in production unknown.",
              "[CODE] With AI checks disabled every submission still shows a 'Qualitative Quality Checks — Status: skipped' box."],
    who="Reviewer", journeys=["J4", "J8"],
    why="Heuristic: visibility of system status; minimalist design (a disabled feature should not take space).",
    options=[opt("A", "Frontend: treat pending > 15 min as 'Stalled — Retry'; stop polling after 10 minutes without change; hide the AI section when the feature is off.", "S", "Threshold needs tuning; Retry needs an endpoint that re-queues one submission.", "—"),
             opt("B", "Backend: a periodic sweep marks jobs pending > 15 min as failed with `llm_last_error='timed out'`, so every client sees the same state; frontend only hides the section when AI is off.", "S–M", "Needs a scheduler (Celery beat).", "Consistent status in exports and counts.")],
    recommendation="B if Celery beat is (or will be) running; otherwise A. Hiding the section when AI is off applies either way.", success="No submission shows 'in progress' for more than 15 min; AI section absent when disabled.",
    confidence="Med", validate_with="Check production logs for jobs pending > 15 min.", effort="S",
))

F.append(dict(
    id="F-18", theme=T4, priority="Now", severity=4, scope="Local", type="Workflow",
    title="The Kobo server URL cannot be saved, so users on non-default Kobo servers cannot connect",
    where=["pages/UserSettingsPage.tsx:22-23 (isProfileDirty ignores the URL)", "…:54-58 (URL only sent by the Profile form)", "…:245 (Profile Save shown only when dirty)", "…:287-301 (URL field sits in the Kobo section)", "…:321-329 (token link hard-coded to kf.kobotoolbox.org)"],
    evidence=["[OBSERVED] Editing only 'Kobo API URL' shows no Save button; 'Save Token' left the server URL at https://kf.kobotoolbox.org/api/v2; after reload the field reverted. The URL persisted only after also editing Full name to make the Profile Save appear (j1.json; j1-05/06 screenshots).",
              "[OBSERVED] Test Connection then tested the default server (it reported 'Could not connect to Kobo API at https://kf.kobotoolbox.org/api/v2')."],
    who="Every organisation on the EU server (eu.kobotoolbox.org), the humanitarian server (kobo.humanitarianresponse.info) or self-hosted Kobo", journeys=["J1"],
    why="These users cannot connect at all without discovering an accidental workaround — a hard block at the first step. Heuristics: visibility of system status; user control.",
    options=[opt("A", "Include the URL in the Kobo section's own save: rename 'Save Token' → 'Save connection', send PUT /users/me {kobo_api_url} and the token together, then auto-test.", "XS–S", "—", "—"),
             opt("B", "A + server picker (Global / EU / Humanitarian / Other) and a token link that follows the chosen server (W3-B).", "S", "Server list must be kept current.", "Fewer typos in URLs.")],
    recommendation="B.", success="A new user on eu.kobotoolbox.org connects in ≤ 4 interactions (pick server, paste token, Save, auto-test) with no profile edit.",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-19", theme=T4, priority="Now", severity=3, scope="Systemic", type="Workflow",
    title="First run has no path: empty states point to an empty sidebar and the Kobo prerequisite is found by error",
    where=["App.tsx:45-54 (same copy on every view: '…to view its settings')", "pages/CreateSurveyPage.tsx:636-638 (plain red error)", "App.tsx:154-170 (views unmount → Create draft lost)"],
    evidence=["[OBSERVED] New account lands on Submissions: 'No survey selected — Please select a survey from the sidebar to view its settings.' while the sidebar says 'No surveys yet.' (j1-03-first-landing.png).",
              "[OBSERVED] Create page shows 'Add your Kobo API key in user settings…' as red text with no link; going there via the user menu and back empties the form (j1-04; leads.js: name '' after round trip).",
              "[OBSERVED] Minimum path from sign-up to first data for a kf.kobotoolbox.org user: 12 interactions + discovering the key step; for other servers not possible without the F-18 workaround."],
    who="New users (beta partners onboarding)", journeys=["J1", "J2"],
    why="First-run friction decides adoption. Documented decision to keep: nothing is auto-selected (SurveyContext.tsx:48-55) — the fix below respects it. Heuristics: help and documentation; error prevention.",
    options=[opt("A", "Copy + links: per-view empty-state copy; when there are no surveys show 'Add your first survey' with a button; the Create page error becomes 'Connect Kobo' opening the connection card in a dialog; persist the Create draft in sessionStorage.", "S", "—", "—"),
             opt("B", "A 3-step setup checklist as the no-survey empty state (W3-A): Connect Kobo → Add survey → Choose checks.", "M", "Needs design of 'recommended checks' (F-23).", "Measurable activation funnel.")],
    recommendation="A now, B next.", success="A new user reaches 'first submissions visible' without an error message, in ≤ 10 interactions after sign-up.",
    confidence="High", validate_with="Time 3 first-time users from sign-up to first review decision.", effort="S→M",
))

F.append(dict(
    id="F-20", theme=T4, priority="Next", severity=3, scope="Local", type="Feature-gap",
    title="Interview date, start and end questions are chosen invisibly and cannot be changed",
    where=["pages/CreateSurveyPage.tsx:125-137 (auto-fill incl. date_interview/start_time/end_time)", "CreateSurveyPage.tsx:792-828 and SurveySettingsPage.tsx:1561-1605 (only Enumerator, Consent, DK shown)",
           "constants/coreIdentifiers.ts:42-61 (help text exists, unused)"],
    evidence=["[OBSERVED] After creating a survey, the saved config had date_interview='today', start_time='start', end_time='end', none of which were shown on any screen (j2.json API read-back).",
              "[CODE] grep: no VariableDropdown for date_interview/start_time/end_time anywhere; the only editor for them (SurveySetupPage) was deleted as unreachable in 105f1b0.",
              "[INFERRED] A form naming its date question e.g. 'survey_date' gets no match; out-of-period, weekend, office-hours and form-based duration checks can be switched on in settings but never flag anything."],
    who="Survey owners with non-standard XLSForm names", journeys=["J2", "J8"],
    why="Checks the user turned on silently do nothing, and the data looks cleaner than it is. Heuristics: visibility; user control. Consistent with the owner's rule 'guess only when unambiguous' (241ebf4) — but a guess must be visible to be checked.",
    options=[opt("A", "Show the three as VariableDropdowns (existing component, help text already written) in Core identifiers on both screens, with the Suggested group.", "S", "More fields on the create form.", "—"),
             opt("B", "A + disable/annotate each dependent check in Data Quality Checks when its identifier is empty ('Needs an interview date question — set it in General').", "S", "—", "Prevents silent no-op checks.")],
    recommendation="B.", success="Every identifier a check depends on is visible and editable; a check whose input is missing says so next to its checkbox.",
    confidence="High", validate_with="Ask 2–3 owners how often their forms deviate from start/end/today naming.", effort="S",
))

F.append(dict(
    id="F-21", theme=T4, priority="Now", severity=3, scope="Local", type="Interaction",
    title="Saving one settings section also saves unsaved edits made in other sections",
    where=["pages/SurveySettingsPage.tsx:648-681 (persistSurveyConfig writes all page state)", "…:796-810 (Outlier save)"],
    evidence=["[OBSERVED] Ticked 'Flag submissions on weekends' in General checks without saving, then saved the Outlier section: the server config then had flag_weekend=true and General showed no pending changes (j8.json 'LEAK TEST')."],
    who="Survey owners", journeys=["J8"],
    why="Changes the user did not intend to commit go live on the next pull and alter flags. Heuristic: user control and freedom; error prevention.",
    options=[opt("A", "Build the saved payload from the last *saved* config plus only the saving section's slice.", "S", "Needs a per-section slice map.", "W4."),
             opt("B", "One page-level Save with a summary of changed sections.", "S–M", "Conflicts with existing per-section habit.", "—")],
    recommendation="A (W4 rules 2–3).", success="Repeat the leak test: flag_weekend stays false on the server.", confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-22", theme=T4, priority="Next", severity=2, scope="Local", type="Interaction",
    title="Survey Settings mixes four different edit-and-save models on one page",
    where=["SurveySettingsPage.tsx (see 00-inventory.md §4)", "Kobo Tool/Targets/Outlier/AI use Edit buttons; Profile/Identifiers/General are live; Custom checks save each rule; Access saves on change"],
    evidence=["[OBSERVED] In one tab: General checks are always editable with Save-when-dirty; Outlier and AI need 'Edit' first; Custom needs 'Edit' then 'Done' and saves per rule (j8-02-quality-tab-initial.png, j8-05-custom-edit.png)."],
    who="Survey owners", journeys=["J8"],
    why="Users must relearn how saving works per card and miss that some changes are already live. Heuristic: consistency and standards.",
    options=[opt("A", "Adopt W4: every card always editable for owners, own dirty state, own Save/Cancel, inline confirmation, unsaved-changes guard.", "M", "Accidental edits (mitigated by dirty marker + guard).", "Removes F-21 class of bugs."),
             opt("B", "Keep Edit buttons everywhere (make General/Profile/Identifiers also Edit-gated).", "S", "Extra click per change.", "—")],
    recommendation="A.", success="All settings cards behave identically; usability test: 5/5 owners correctly predict whether a change is saved.",
    confidence="Med", validate_with="5-person hallway test on the settings page.", effort="M",
))

F.append(dict(
    id="F-23", theme=T4, priority="Next", severity=3, scope="Local", type="Workflow",
    title="New surveys start with almost every check off, so the first pull looks clean",
    where=["pages/CreateSurveyPage.tsx:333-353 (no quality_checks in created config)", "components/QualityCheckPromptModal.tsx (yes/no prompt)"],
    evidence=["[OBSERVED] After creating a survey and pulling: '147 checked, 3 flagged'; quality_checks was null. After enabling six checks: 43 flagged (j2.json, j8.json)."],
    who="New survey owners", journeys=["J2", "J8"],
    why="The first impression ('3 of 147 flagged') is the opposite of the truth, and the configure prompt is dismissible with 'Later'. Documented decision to respect: collection dates are optional (CreateSurveyPage.tsx:283-287).",
    options=[opt("A", "Offer a pre-ticked 'recommended set' in the create flow (duration limits blank until set, weekend + office hours, DK %, outliers on numeric questions the owner confirms), with a one-line explanation each.", "S–M", "Defaults may not fit every context (e.g. weekend days).", "F-19B step ③."),
             opt("B", "After the first pull, if no checks are on, show 'Only 2 basic checks ran. Turn on recommended checks?' in the banner.", "S", "Still starts clean.", "—")],
    recommendation="A; B as a safety net.", success="First pull on a new survey runs ≥ 5 checks unless the owner deliberately turned them off.",
    confidence="Med", validate_with="Owner decision on the recommended set (Q6).", effort="S–M",
))

F.append(dict(
    id="F-24", theme=T4, priority="Next", severity=2, scope="Local", type="Content",
    title="AI rule buttons say 'Add to Editor' but save live rules; rule delete has no confirm or undo",
    where=["components/rule-builder/AINaturalLanguageInput.tsx:206", "AISuggestedRules.tsx:135 ('added to editor!')", "SurveySettingsPage.tsx:934-981 (saves immediately)", "rule-builder/StagedRulesList.tsx:39 (delete immediately)"],
    evidence=["[OBSERVED] After 'Accept & Add to Editor' the manual editor stayed empty and the rule was already on the server (j8.json)."],
    who="Survey owners", journeys=["J8"],
    why="The label promises a review step that does not exist; the rule starts flagging on the next pull. Heuristics: match; error prevention.",
    options=[opt("A", "Rename to 'Add rule' / 'Add 3 rules'; success text 'Rule added — it will run on the next pull'; delete → Undo toast.", "XS", "—", "—"),
             opt("B", "Actually load the AI rule into the manual editor for review before saving.", "S", "One more click.", "Safer AI use.")],
    recommendation="B for single rules (AI output deserves a look), A for copy everywhere.", success="No AI rule is saved without the user seeing its conditions in the editor.",
    confidence="High", validate_with="", effort="XS–S",
))

F.append(dict(
    id="F-25", theme=T4, priority="Later", severity=1, scope="Local", type="Content",
    title="Settings asks for a 'Kobo Asset ID' although creation deliberately asks for a project link",
    where=["pages/SurveySettingsPage.tsx:1174-1191", "pages/CreateSurveyPage.tsx:53-56 (documented reason: Kobo never shows 'asset ID')"],
    evidence=["[CODE] Create page comment: \"Kobo's own interface never shows the term 'asset ID'\"; Settings labels the same field 'Kobo Asset ID' and accepts free text without re-reading the form."],
    who="Survey owners", journeys=["J8"], why="Contradicts a documented team decision. Heuristic: consistency.",
    options=[opt("A", "Use the same 'Kobo project link' field (parseKoboAssetId) in Settings and re-read the form on change.", "S", "—", "—"),
             opt("B", "Make the project read-only after creation (changing projects = new survey).", "XS", "Blocks legitimate project moves.", "—")],
    recommendation="A.", success="Neither screen shows 'asset ID'.", confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-26", theme=T5, priority="Next", severity=3, scope="Systemic", type="Accessibility",
    title="Keyboard users need 147 Tab presses to reach the decision; charts, cards and table rows are mouse-only",
    where=["Dashboard.tsx:304-336 (list before detail in tab order)", "StatusSummaryCards.tsx:14 (div onClick)", "PerformanceDataView.tsx:23-25, 213-222, 241-245 (span/th/tr onClick)", "EnumeratorLeaderboard.tsx:155-161", "recharts bars/dots with onClick"],
    evidence=["[OBSERVED] From a selected first queue item to its status control: 147 Tab presses (tabcount.js).",
              "[OBSERVED] Unreachable click targets with tabIndex −1: 9 on Data Quality (status cards, bars), 43 on Field Team (rows, sort headers, ⓘ icons, bars, dots, leaderboard rows) (audit.json)."],
    who="Keyboard and switch users; fast expert reviewers", journeys=["J4", "J5", "J6"],
    why="WCAG 2.1.1 Keyboard (A) fails. The review loop is effectively unusable without a mouse.",
    options=[opt("A", "Add a 'Skip to details' link / move focus to the detail heading on selection; convert clickable divs/rows/th/spans to buttons (or add role/tabIndex/Enter handling); provide a table alternative to chart clicks.", "S–M", "—", "F-03 shortcuts."),
             opt("B", "Roving tabindex for the queue (one Tab stop, arrows inside).", "S", "Needs ARIA listbox semantics.", "Tab count to decision ≤ 3.")],
    recommendation="A + B.", success="≤ 3 Tab presses from a selected queue item to the decision; every clickable element reachable and operable by keyboard (axe + manual).",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-27", theme=T5, priority="Now", severity=3, scope="Systemic", type="Accessibility",
    title="Form labels are not connected to their fields (and clicking a checkbox's text does nothing)",
    where=["58 `<label>` elements without htmlFor across pages (grep)", "SurveySettingsPage.tsx:1779-1800 etc. (checkbox + separate label)", "VariableDropdown.tsx:43-46", "UserSettingsPage.tsx:196-230"],
    evidence=["[OBSERVED] axe 'label'/'select-name' (critical) on 7 of 13 screens: Settings General (4+3), Quality (10), Custom edit (10+2), Create (4), Account (4), Access (2), Data Quality (2) (audit.json).",
              "[OBSERVED] Clicking 'Flag submissions outside the collection targets' text did not toggle its checkbox (j8.json)."],
    who="Screen-reader users; everyone (small 16 px checkbox is the only click target)", journeys=["J1", "J2", "J8", "J9"],
    why="WCAG 1.3.1, 3.3.2 and 4.1.2 fail; also a Fitts's-law problem for all users.",
    options=[opt("A", "Use the existing FormField component (the only one that binds labels, aria-invalid, aria-describedby) for every input/select; wrap checkboxes in their label.", "S–M (mechanical)", "Touches many files.", "Consistent error display."),
             opt("B", "Add ids/htmlFor in place without refactor.", "S", "Drift returns.", "—")],
    recommendation="A.", success="axe reports 0 label/select-name violations; every checkbox toggles from its text.",
    confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-28", theme=T5, priority="Now", severity=3, scope="Systemic", type="Accessibility",
    title="Keyboard focus is invisible on queue items and weak elsewhere",
    where=["components/SubmissionListItem.tsx:15 (focus:outline-none, no replacement)", "SurveySettingsPage delete modal buttons (outline none)"],
    evidence=["[OBSERVED] Focused queue item: outline 'solid 2px rgba(0,0,0,0)', box-shadow none (kbd.json queueItemFocusStyle); nav buttons rely on the browser default."],
    who="Keyboard users", journeys=["J4"], why="WCAG 2.4.7 Focus visible (AA) fails on the core list.",
    options=[opt("A", "Global base style: `*:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px }` in index.css, and delete bare `focus:outline-none` (SubmissionListItem.tsx:15 and dialog buttons).", "XS", "Double rings where components already add `focus:ring-*`; remove those as touched.", "F-33 focus token."),
             opt("B", "Per-component rings (`focus-visible:ring-2 ring-indigo-600`) added where missing.", "S", "Easy to miss new components; drift returns.", "—")],
    recommendation="A — one rule covers every current and future control.", success="Every focusable element shows a ≥ 3:1 focus indicator (manual pass).", confidence="High", validate_with="", effort="XS",
))

F.append(dict(
    id="F-29", theme=T5, priority="Now", severity=2, scope="Systemic", type="Accessibility",
    title="Text and control boundaries fall below contrast minimums in eight places",
    where=["SubmissionListItem.tsx:35 (#ca8a04)", "Sidebar.tsx:223 (opacity-60 email)", "Sidebar.tsx:157 (opacity-75 asset id)", "ProgressBar.tsx:41", "EnumeratorSummaryCards.tsx (text-gray-400 sublabels)",
           "SurveySettingsPage 'Tool configured' green-600", "LoginPage.tsx:83 (white on indigo-500)", "all inputs border-gray-300"],
    evidence=["[OBSERVED] Measured (axe + computed): '1 Issues' 2.37:1 (#ca8a04 on #e5e7eb) and 2.66:1 on #f3f4f6; Field Team sublabels 2.53:1; sidebar email 3.28:1; green-600 3.15:1; progress % 3.43:1; asset ID on selected 4.27:1; login tab 4.47:1; input borders 1.47:1 (non-text, 1.4.11).",
              "[OBSERVED] Dark mode: Field Team gray-500 on gray-800 3.04:1; other screens pass except the sidebar asset ID."],
    who="Low-vision users; anyone on a laptop in daylight (field offices)", journeys=["J4", "J6", "J7"],
    why="WCAG 1.4.3 (AA) and 1.4.11 (AA) fail; the most important list signal ('n issues') is the least legible text on screen.",
    options=[opt("A", "Swap classes in place: amber-700 #b45309 for the issue count (4.56:1; amber-800 #92400e 5.73:1 on the selected row), gray-600 for secondary text (7.23:1), gray-500 for Field Team sublabels (4.83:1), green-700 (4.8:1), progress % label outside the bar in gray-900 (14.33:1 on the track) or white on blue-600 (5.17:1), indigo-600 login tab (6.29:1), gray-500 input borders (4.83:1).", "XS–S", "Slightly heavier look; will drift again without tokens.", "—"),
             opt("B", "Define the semantic tokens first (text-secondary, signal-issue, border-control …, F-33) with the same values, then migrate usages.", "S–M", "Slower to ship the fix.", "Prevents regressions; one place to tune.")],
    recommendation="A now (minutes per instance), folded into B when F-33 tokens land.", success="axe color-contrast = 0 on all 13 screens in light and dark.", confidence="High", validate_with="", effort="XS–S",
))

F.append(dict(
    id="F-30", theme=T5, priority="Next", severity=2, scope="Systemic", type="Accessibility",
    title="Dialogs and custom dropdowns lack dialog semantics, focus management and Escape",
    where=["SurveySettingsPage.tsx:1053-1098 (delete survey)", "UserSettingsPage.tsx:488-521 (delete account)", "progress-tracker/InfoModal.tsx", "QualityCheckPromptModal.tsx", "SubmissionFilters.tsx:32-180 (MultiSelectDropdown), 100 (button nested in button)"],
    evidence=["[OBSERVED] Delete-survey dialog: no role, focus stays on the page button, Escape does nothing, Tab leaves the dialog (kbd.json).",
              "[OBSERVED] Filter dropdown: no aria-expanded/aria-haspopup; Escape does not close; React warns '<button> cannot be a descendant of <button>' for chip × buttons (j4 console)."],
    who="Keyboard and screen-reader users", journeys=["J4", "J8", "J9"], why="WCAG 2.4.3, 4.1.2 fail; nested buttons are invalid HTML.",
    options=[opt("A", "Use Headless UI Dialog and Listbox (already a dependency, used for the status Menu) for all four dialogs and the multi-select.", "S–M", "—", "Consistent behaviour."),
             opt("B", "Hand-roll focus trap/Escape.", "S", "Re-implementing solved problems.", "—")],
    recommendation="A.", success="All dialogs: focus moves in, Escape closes, focus returns; axe nested-interactive = 0.", confidence="High", validate_with="", effort="S–M",
))

F.append(dict(
    id="F-31", theme=T5, priority="Next", severity=2, scope="Systemic", type="Accessibility",
    title="Page title never changes, status messages are not announced, login lacks autocomplete",
    where=["index.html:7 (title 'Field compass')", "Dashboard.tsx:290-299 and 3 other pages (banners without role)", "LoginPage.tsx:115-188 (no autocomplete)"],
    evidence=["[OBSERVED] Title 'Field compass' on every view (kbd.json titles).", "[OBSERVED] ETL banners and 'Showing n submissions' have no live region (audit DOM).",
              "[OBSERVED] Login inputs autocomplete=null (kbd.json)."],
    who="Screen-reader users; password-manager users", journeys=["J1", "J3"], why="WCAG 2.4.2, 4.1.3, 1.3.5 fail.",
    options=[opt("A", "Targeted fixes: set document.title in each view's effect ('Submissions · Household Resilience 2026 · Field Compass'); `role=status` on pull banners and the list count; autocomplete=email / current-password / new-password / username on auth forms.", "XS", "Titles must be kept in sync by hand in each page.", "—"),
             opt("B", "Derive titles and announcements centrally: the router (F-32) sets titles from route metadata, and the shared Banner/PullStatus components (F-33) carry live-region roles.", "S (after F-32/F-33)", "Waits on foundations.", "No per-page upkeep.")],
    recommendation="A now (under an hour); let B replace it when the router and Banner exist.", success="Titles differ per view; NVDA announces pull outcomes; password managers fill login.", confidence="High", validate_with="", effort="XS",
))

F.append(dict(
    id="F-32", theme=T6, priority="Next", severity=3, scope="Systemic", type="IA/Navigation",
    title="Nothing has a URL: no deep links, no Back, no shareable submission",
    where=["App.tsx:15, 73-87 (view in useState + localStorage)", "App.tsx:95-110 (window CustomEvents for navigation)"],
    evidence=["[CODE] Views are component state; the selected submission and filters are not persisted anywhere.",
              "[INFERRED] A supervisor cannot send 'look at #300246' as a link; browser Back leaves the app; refresh drops the open submission and filters."],
    who="Reviewers collaborating with supervisors; anyone using Back", journeys=["J4", "J5", "J6", "J9"],
    why="Collaboration on specific submissions is central to QA ('can you check this one?'). Heuristics: user control and freedom; recognition over recall.",
    options=[opt("A", "Introduce a router with /surveys/:surveyId/{submissions,quality,progress,team,settings} and /submissions/:id?status=&issue=; keep the 'nothing auto-selected' rule (the URL *is* an explicit choice).", "M", "Touches every page; migration of cross-page events.", "F-05B, F-03 deep links, shareable filters."),
             opt("B", "Hash-based state for survey + submission only.", "S", "Half-measure; still no Back per view.", "Links to submissions.")],
    recommendation="A as a foundation in the Next cycle.", success="Copying the address bar reopens the same survey, view, filter and submission for a colleague with access.",
    confidence="High", validate_with="", effort="M",
))

F.append(dict(
    id="F-33", theme=T6, priority="Next", severity=2, scope="Systemic", type="Visual",
    title="No shared tokens or components: 59 button styles, 36 text colours, 9 font sizes, four copies of the refresh header",
    where=["tailwind.config.js (one custom token)", "frontend/**/*.tsx (220 distinct colour utilities, 23 primary-button class variants, 21 hard-coded hex colours, 8 inline spinner SVGs)", "Dashboard.tsx / QualityOverviewDashboard.tsx / DataCollectionProgressPage.tsx / EnumeratorPerformancePage.tsx (4 refresh implementations)"],
    evidence=["[OBSERVED] Computed-style crawl of 13 screens: 59 distinct button styles, 36 text colours, 33 backgrounds, radii 4/6/8/12/16/full, headings H2 at 16/18/20 px, 12 px text = 58 % of text nodes (audit.json).",
              "[CODE] Four ETL banner strings with different fields (e.g. only Dashboard mentions AI checks)."],
    who="Everyone (inconsistency) and the maintainer (every fix is done 4×)", journeys=["all"],
    why="Inconsistency is why several findings exist 4× (F-13, F-16). Heuristic: consistency and standards.",
    options=[opt("A", "Define semantic tokens in tailwind.config (text-primary/secondary/warning, surface, border-control, focus) and 8 components: Button (primary/secondary/danger/ghost × sm/md), Field, Card/Section, Banner (status/alert), Dialog, Spinner, PageHeader (+PullStatus), Tabs.", "M", "Churn across files; do alongside feature work.", "F-13, F-15, F-27, F-28, F-29, F-30."),
             opt("B", "Adopt a component library (e.g. Headless UI + a Tailwind kit) wholesale.", "L", "Visual regression; learning.", "—")],
    recommendation="A, incrementally: build each component when the first finding that needs it is fixed.", success="≤ 8 button styles and ≤ 12 text colours in the same crawl; one PullStatus component.",
    confidence="High", validate_with="", effort="M",
))

F.append(dict(
    id="F-34", theme=T7, priority="Next", severity=2, scope="Systemic", type="Interaction",
    title="Viewers see every action enabled and learn about their role from raw 403 errors",
    where=["ValidationStatusDropdown usage in SubmissionDetail.tsx:490-495", "SubmissionDetail.tsx:632-639 (Save notes)", "Dashboard.tsx:269-287 (Refresh)"],
    evidence=["[OBSERVED] As Viewer: status menu, Save notes and Refresh enabled; Approve → 'This action requires editor access or higher'; Refresh → 'ETL pipeline failed: 403: This action requires editor access or higher' and the list replaced (j9.json; j9-05, j9-06)."],
    who="Viewers (donors, managers, partners)", journeys=["J9"], why="Heuristics: error prevention; match (the Viewer badge is tiny and only in the sidebar).",
    options=[opt("A", "Pass `permission` to the Submissions and data pages; hide Refresh, render status as a read-only pill, disable notes with 'Viewers can read notes'.", "S", "—", "—"),
             opt("B", "A + a one-line role banner at the top of each survey for viewers.", "S", "Noise for frequent viewers.", "—")],
    recommendation="A.", success="A viewer session produces zero 403 responses in normal navigation.", confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-35", theme=T7, priority="Now", severity=3, scope="Systemic", type="Feedback/States",
    title="An expired session is not detected on data pages; 'Try again' launches a full pull",
    where=["services/api.ts:43-80, progressApi.ts, qualityApi.ts (no 401 handling)", "contexts/AuthContext.tsx:104-108 (only user endpoints log out)", "QualityOverviewDashboard.tsx:123-135 ('Try again' → handleRefresh → ETL)"],
    evidence=["[OBSERVED] With an invalid token: Submissions shows 'Failed to fetch submissions.' twice; Data Quality shows 'Could not validate credentials — Try again' (j9-08, j9-09). The app stays 'signed in'.",
              "[CODE] 'Try again' calls handleRefresh, which runs the whole Kobo pipeline, not a reload of the dashboard."],
    who="Everyone after 24 h (JWT_EXPIRE_MINUTES default 1440)", journeys=["J9", "J4"],
    why="Users see generic failures and retry pointlessly; the retry triggers an expensive pull. Heuristic: help users recognise and recover from errors.",
    options=[opt("A", "One fetch wrapper for all services: on 401 open a 'Your session expired — sign in again' dialog that preserves in-page state (typed notes) and resumes.", "S", "—", "—"),
             opt("B", "Hard logout on 401 (as authFetch does).", "XS", "Loses unsaved notes/settings edits.", "—")],
    recommendation="A (adversarial review: B loses work mid-review). Also make 'Try again' reload the dashboard, not run a pull.",
    success="With an expired token, the next action shows a sign-in prompt; after signing in the user is on the same view with typed text intact.",
    confidence="High", validate_with="", effort="S",
))

F.append(dict(
    id="F-36", theme=T1, priority="Next", severity=3, scope="Local", type="Perceived-performance",
    title="The queue downloads every submission twice on each survey switch",
    where=["components/Dashboard.tsx:32-65 (fetchSubmissionsAcrossPages loops all pages)", "Dashboard.tsx:68-82 (all, for filter options) + 85-114 (filtered)"],
    evidence=["[OBSERVED] Selecting a 147-submission survey issued 14 API calls including 8 submission pages (dev StrictMode doubles effects; ≈4 in production) (reqs.js).",
              "[INFERRED] At 20 000 submissions that is ≈400 sequential 100-row requests per survey switch in production, plus a full re-page on every filter change; each response carries full submission_data."],
    who="Teams with large surveys", journeys=["J4"], why="Perceived performance of the most-used screen degrades linearly with survey size. Heuristic: system response time.",
    options=[opt("A", "Server-side pagination/virtualised list (page of 50, infinite scroll) and a lightweight list endpoint (id, enumerator, district, status, issue checks); fetch filter options from a /facets endpoint.", "M", "Backend work; keyboard nav across pages.", "F-01 counts from `total`."),
             opt("B", "Keep client-side but fetch once and filter locally.", "S", "Memory; still O(n) download.", "—")],
    recommendation="A.", success="Queue first paint < 1.5 s at 20k submissions on a 3G-class connection.",
    confidence="Med", validate_with="Load-test with 20k synthetic submissions.", effort="M",
))


def main():
    for f in F:
        f.setdefault("validate_with", "")
    with open(os.path.join(ROOT, "findings.json"), "w") as fh:
        json.dump(F, fh, indent=2, ensure_ascii=False)
    order = {"Now": 0, "Next": 1, "Later": 2}
    lines = []
    for theme in [T1, T2, T3, T4, T5, T6, T7]:
        items = sorted([f for f in F if f["theme"] == theme], key=lambda f: (order[f["priority"]], -f["severity"], f["id"]))
        if not items:
            continue
        lines.append(f"### {theme}\n")
        for f in items:
            lines.append(f"#### {f['id']} — {f['title']}\n")
            lines.append(f"**Type** {f['type']} · **Severity** {f['severity']} · **Scope** {f['scope']} · **Priority** {f['priority']} · **Confidence** {f['confidence']}" + (f" (validate with: {f['validate_with']})" if f['validate_with'] else "") + f" · **Effort** {f['effort']}\n")
            lines.append("**Where** " + "; ".join(f"`{w}`" if "/" in w or ".tsx" in w or ".py" in w else w for w in f["where"]) + "\n")
            lines.append("**Evidence**\n" + "\n".join(f"- {e}" for e in f["evidence"]) + "\n")
            lines.append(f"**Who / journeys** {f['who']} — {', '.join(f['journeys'])}\n")
            lines.append(f"**Why it matters** {f['why']}\n")
            lines.append("**Options**\n\n| Opt | Change | Effort | Risks | Unlocks |\n|---|---|---|---|---|\n" + "\n".join(
                f"| {o['id']} | {o['change']} | {o['effort']} | {o['risks']} | {o['unlocks']} |" for o in f["options"]) + "\n")
            lines.append(f"**Recommendation** {f['recommendation']}\n")
            lines.append(f"**Success signal** {f['success']}\n")
    with open(os.path.join(ROOT, "_catalog.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(len(F), "findings")


if __name__ == "__main__":
    main()

# Field Compass — UI/UX design review

Commit reviewed: `2e4d096` (main, 2026-09-29) · Review date: 2026-09-29 · Evidence: local running app with synthetic data + source reading.
Companion files: [`findings.json`](findings.json) (same 36 findings, machine-readable) · [`00-inventory.md`](00-inventory.md) · [`wireframes/`](wireframes/) (W1–W5) · [`screenshots/`](screenshots/) · [`fixtures/`](fixtures/) (mock Kobo/OpenAI, stack script, findings builder).
Screenshot references such as `j4-03` mean `screenshots/j4-03-*.png` (journey 4, step 3); `state-*`, `reflow-*`, `dark-*` and `kbd-*` are named in full.

**Progress is tracked in [§0](#0-status--2026-10-09).** Sections 1–10 are the original review and are left as written; their file and line references point at `2e4d096`.

---

## 0. Status — 2026-10-09

Checked against `main` at `abbd9af` (after #90), by reading the code and the PRs merged since the review. #87 to #90 were checked in a browser against the mock Kobo. Contrast and keyboard figures are still the review's.

**Summary: 23 done, 10 partly done, 3 open.**

- Roadmap step 0 (data-loss bug) and step 1 (honesty quick wins) are **done**: #64, #67, #69, #73, #79.
- Part of step 3 is in: tokens and shared components (#71), and persisted pull runs with an activity panel (#73).
- Step 2, **Review loop v1**, is **done** in #87: review tabs, a filter menu with counts, a findings card next to the decision, auto-advance with Undo, keyboard shortcuts, and approving clean submissions together.
- #87 then took several rounds of feedback from using it: clearer decision buttons, a wider focus layout, answers shown as the form showed them, and light motion between submissions ([below](#87-after-hands-on-testing)).
- #88 to #90 did the next steps agreed on 2026-10-09:
  - each survey's stored form follows Kobo on every pull, so what #87 reads from the form (group titles, notes, the options a respondent was offered) reaches every survey;
  - the date, start and end questions can be chosen (F-20);
  - Field Team counts submissions with no enumerator apart (F-11);
  - every data page says when it was last pulled (F-14);
  - viewers no longer get the pull button (F-34);
  - every page and submission has its own address and browser-tab title (F-32, F-31).

### What changed since the review

| PR | What it did for the review |
|---|---|
| #64 | Fixed the §10 data-loss bug: a list of don't-know codes crashed AI checks and discarded flags. |
| #67 | AI check failures are recorded, not stored as clean (F-13 for AI). AI-only findings now set `qa_status` (F-10 B). A beat task fails checks stuck in `running`/`pending` (F-17). |
| #69 | Setup checklist for users with no surveys (F-19 B). One Kobo connection form with a Global / EU / own-server picker; the server and key are saved together after Kobo accepts the key (F-18). |
| #71 | Neutral palette, Inter, one type scale. Shared `Button`, `PageHeader`, `Card`, `Banner`, `Badge`, chart theme (F-33). Global `:focus-visible` ring (F-28). Contrast fixes (F-29). `autocomplete` on sign-in (F-31). |
| #72 | `issueNames.ts`: readable check names in charts and detail (F-12). "AI review" vocabulary. Custom-check composer: nothing saves until "Save check", and delete asks first (F-24). The false "click a bar to filter" hint is gone (F-09). One `FieldLabel` pattern (F-27). |
| #73 | Pulls run in the background with stages, an activity panel and notifications (F-14, part). A refused pull fails in words, never "0 fetched" (F-13). A failed pull no longer replaces the list (F-16). |
| #75 | Pick the Kobo project from a list; paste a link as fallback (F-19, F-25 context). |
| #79 | Step 1: one `PullButton` on four pages, outcome in the top bar (F-13). Field Team relabelled; podium, medals and verdicts removed; neutral ranking by issues per submission (F-08 A, part of B). Sign-in dialog on 401 that retries the request (F-35). Each settings section saves only its own fields, shows "Saved hh:mm", and errors stay until dismissed (F-15, F-21). |
| #83, #85 | `NavigationContext` holds all navigation, which makes a router easier (F-32). `SurveySettingsPage` split into sections with one section editor (F-22). Settings labels bound to inputs; delete dialog has `role="dialog"` (F-27, F-30). Dead code removed, including the unused `HistoryViewer` (F-06). |
| #87 | Review loop v1, built from the [design canvas](https://claude.ai/artifact/DB3CT24FcFGXTW5NB4AehD) (layout A with the focus toggle). Tabs Needs review · On hold · Reviewed · All with counts; search; one filter menu (issue, enumerator, groups) with counts per option; sort (F-01 A+B). A findings card at the top of the submission: one sentence per finding, the note and the decision buttons together; the four check sections become one "All checks" list (F-02). After a decision the submission leaves a tab it no longer fits, the next opens, Undo for 8 s; A/N/H, J/K, Z, / (F-03, F-26). Both are per-account settings, on by default. Data quality bars open the list filtered to their issue (F-09 B). Approve clean submissions together, in Kobo's bulk endpoint. |
| #88 | Each pull reads the form from Kobo and stores it when it changed, keeping the chosen label language; one builder (`services/kobo_form.py`) makes the stored rows for the pull and the form endpoint. Pickers for the interview date, start and end questions on Create and Settings (F-20 B). |
| #89 | Field Team counts submissions with no enumerator apart and links to them; the queue's enumerator filter gains "No enumerator recorded" (F-11). "Last pulled 3 h ago" beside the pull button on every data page (F-14 A). Viewers don't get the pull button (F-34). |
| #90 | An address for every page and submission (`/surveys/<id>/submissions/<kobo id>?review=…`): links, reloads, Back and Forward land in the same place (F-32). A browser-tab title per page and open submission (F-31). |

#66 (the first step-1 PR) was closed unmerged and redone as #79. Three things in #66 were not carried over: per-view `document.title`, the 8 s Undo on rule delete, and the amber "pulled 800 of 1 000" partial pull. Today a Kobo error part-way through fails the whole pull (`kobo_fetcher.py`, `KoboFetchError`), which is honest, but the pages already read are not kept.

### #87 after hands-on testing

What changed in #87 after the first version, from using the queue on the mock Kobo:

- **Decisions read at a glance.** Undecided buttons are neutral; the chosen one fills with its colour (green, rose, amber) and a tick, so colour means "chosen". The first button reads "Approved". After a decision only that button changes: it shows for 600 ms, then the next submission opens. The heading keeps "N things to check", and "Marked … in Kobo" appears only on a submission that arrived already decided, so nothing on the card moves.
- **Focus layout.** With the list hidden, the findings and the answers sit side by side on wide screens and scroll separately, and the decision buttons stay pinned at the bottom of the findings column however long it is. The answers toggle reads "With issues / All", the words the list uses.
- **Answers as the form showed them.** A select-one or select-multiple question lists every option, the chosen ones marked; a list longer than six folds to the chosen ones with "Show all N options". Labels fill `${question}` references with the submission's answers and keep bold and italic. A question with a `choice_filter` lists only the options that respondent was offered (the backend now keeps the choice sheet's extra columns); an option the respondent chose that the current form would no longer offer is still shown, as chosen. When a filter can't be followed, the whole list folds and a line suggests refreshing the form.
- **Light motion.** The next submission rises 8 px into place over 280 ms (and drops in when moving back up), the selected row's highlight glides from row to row, and a decided row folds away in its decision's colour in the last 200 ms of the pause. None of it plays with reduced motion.

### Finding status

✅ done · 🟡 partly done · ⬜ open. Sorted by the original priority.

| ID | Finding (short) | Status | Where it stands / what is left |
|---|---|---|---|
| F-13 | Failed pulls shown as success | ✅ | #64, #67, #73, #79. Partial pulls now fail outright instead of keeping the pages read (see above). |
| F-18 | Kobo server can't be saved | ✅ | #69. Server picker, key checked before saving. |
| F-08 | Field Team ranks review progress as quality | 🟡 | A done (#79). Ranking by issues per submission is in. Left: W2 table of coordinator signals, which needs validating first (Q4, Q5). |
| F-01 | Can't isolate flagged submissions | ✅ | #87: review tabs (On hold has its own), issue filter, sort. Counts come from `/api/submissions/facets`. |
| F-02 | Flag reason below the fold | ✅ | #87: findings card with the decision; findings also sit under their answers. |
| F-03 | No auto-advance; filtered list goes stale | ✅ | #87. Auto-advance and shortcuts are settings in Account settings › Reviewing. |
| F-09 | Issue bars promise a filter | ✅ | #87: a bar opens All filtered to its issue, so the count matches. |
| F-15 | Save confirmations wiped; errors auto-hide | ✅ | #79. |
| F-19 | No first-run path | ✅ | #69 checklist, #75 project picker. |
| F-21 | One section's save commits others' edits | ✅ | #79. |
| F-27 | Labels not bound to fields | 🟡 | 40 of 68 `<label>`s have `htmlFor` (Settings sections done in #85; #87 binds its own). Left: e.g. the survey name and "Kobo asset ID" in `SurveySettingsPage.tsx`, Create survey, filters. |
| F-28 | Invisible focus on queue rows | ✅ | #71 global ring; queue rows keep it. |
| F-35 | Expired session not detected | ✅ | #79. |
| F-29 | Contrast failures | 🟡 | Palette and issue chip fixed in #71 (amber-800). #87's chosen decision buttons are white on emerald-, rose- and amber-700 (about 5:1 or better). Not re-measured. |
| F-05 | No detail pane below 768 px / 200 % zoom | ✅ | #87: below 768 px the list gives way to the submission, with "← List". |
| F-10 | Counts disagree across screens | 🟡 | B done (#67): AI-only findings set `qa_status`. Progress no longer filters by validation status. Left: A, one glossary of named counts used on every screen. |
| F-14 | No data-freshness indicator | ✅ | Runs are stored and the activity panel lists recent ones (#73). #89: "Last pulled 3 h ago" beside the pull button on every data page. |
| F-20 | Date / start / end identifiers invisible | ✅ | #87: the submission's "All checks" list says when a check couldn't run and links to Settings. #88: pickers on Create and Settings, conventional names suggested. Surveys created on 2026-10-02 between #68 and #70 (#70) may have them empty; Settings can now fix them. |
| F-23 | New surveys start with checks off | ⬜ | Every `flag_*` defaults to `False` (`services/survey_config.py:273-289`). Needs Q6. |
| F-26 | Keyboard: 147 Tabs to decide | 🟡 | #87: shortcuts to move and decide, a setting (WCAG 2.1.4). Left: the charts are still mouse-only. |
| F-32 | No URLs | ✅ | #90: an address for every page, settings tab and submission, with the queue's tab and filters; links, reloads, Back and Forward land in the same place. |
| F-36 | Queue downloads everything twice | 🟡 | #87: once, not twice (filter options come from the counts endpoint). Left: it still pages through the whole tab. Urgency depends on Q10. |
| F-04 | Rows lack who / where / what | ✅ | #71, #87: enumerator name and place on the row, the issue count with the names in its tooltip (a row can have several). |
| F-11 | Enumerator codes; phantom "Unknown" | ✅ | #87: names (choice labels) on Submissions rows, detail and filter. Field Team keeps enumerator IDs (decided 2026-10-09). #89: blank values are counted apart, with a link to them, rather than as an "Unknown" enumerator. |
| F-12 | Jargon and check IDs | 🟡 | Mostly done (#72, #79). Left: "Avg. DK Rate (%)" (`PerformanceDataView.tsx:38, 372`) and "run ETL" in the Access tab's role text (`SurveyAccessTab.tsx:202`). |
| F-16 | Failed pull replaces the list | ✅ | #73, #79. |
| F-22 | Four save models on one page | 🟡 | One section editor and tabbed layout (#72, #83, #85). Every section still needs Edit first; whether to drop that is validate-first. |
| F-24 | AI "Add to editor" saves live | ✅ | #72. |
| F-30 | Dialogs lack semantics | 🟡 | 7 of 10 overlays have `role="dialog"` (#87's filter menu is one). `ConfirmDialog` closes on Escape. Left: `InfoModal`, `QualityCheckPromptModal`, the dialog in `UserSettingsPage`; focus trap and focus return not checked. |
| F-31 | Title, live regions, autocomplete | ✅ | Autocomplete done (#71). 17 live regions (#87 added 6, among them the decision toast). #90: `document.title` per page and open submission. |
| F-33 | No tokens / shared components | 🟡 | Tokens and components exist (#71). Adoption is partial: 25 `<Button>` against 156 raw `<button>`. Move screens over as they are touched. |
| F-34 | Viewers see actions they can't perform | ✅ | Settings sections check `canEdit`; #87 hides decisions, notes, "Open in Kobo" and bulk approval from viewers, #89 the pull button. |
| F-06 | Edit history not viewable | ⬜ | `HistoryViewer` was removed as dead code in #83. `GET /submissions/{id}/history` still exists; option B now starts from scratch. |
| F-07 | Kobo call on every click | ✅ | #87: the edit link is asked for when "Open in Kobo" is clicked, and a failure says so. |
| F-17 | AI check can hang forever | ✅ | #67 beat task. |
| F-25 | "Kobo asset ID" in Settings | ⬜ | Still a free-text field (`SurveySettingsPage.tsx:688`). |

### Next five

Everything from the 2026-10-09 list is done (#88 to #90). What is left, in order:

| # | Change | Findings | Effort | Why now |
|---|---|---|---|---|
| 1 | **Small finishes**: the last two jargon strings ("Avg. DK Rate (%)", "run ETL"), the Kobo project in Settings as the same project link as Create rather than a typed asset ID, the remaining unbound labels, and dialog semantics on the last three overlays | F-12, F-25, F-27, F-30 | S | Each is small, and together they close four findings. |
| 2 | **One glossary of named counts** (Pulled, With issues, Needs review, Approved), used verbatim on every screen, with a footnote where a view leaves something out | F-10 A | S–M | The last source of numbers that disagree between pages. |
| 3 | **Edit history**: "Edited in Kobo" opens the changes as "Question: old → new" | F-06 B | M | The badge says a submission changed but not how; the history endpoint is there. |
| 4 | **Keyboard access beyond the queue**: a table alternative to chart clicks, and the remaining clickable non-buttons | F-26 A | S–M | Shortcuts cover the queue; the charts are still mouse-only. |
| 5 | **Re-measure contrast** and fix what still fails | F-29 | S | The palette changed twice (#71, #87) since the review measured it. |

Waiting on answers: F-36 server pagination (Q10, survey sizes), F-23 recommended default checks (Q6), F-08 B the coordinator table (Q4, Q5), and F-22 whether sections should drop Edit-first (validate with users).

---

## 1. Executive summary

**Verdict.** Field Compass already does the hard, invisible work well: it reads a Kobo project from a link, lints the form, runs sensible checks (duration, outliers, don't-know rates, AI review of open text) and explains its own empty states more honestly than most tools. The interface around that engine has not caught up. The core job — *find the submissions that need me, understand why, decide, move on* — takes a scan of the whole list, a scroll past passed checks, and three clicks per item, with no way to isolate flagged work. Worse, several screens **report things that are not true**: a failed pull from Kobo shows a green "ETL completed: 0 fetched"; a backend crash that discarded the flags on 146 of 147 submissions still showed "43 flagged"; the Field Team page ranks enumerators by how far *reviewers* have got while labelling it data quality (the planted 6-minute-interview enumerator ranked #3 "Top performer"); and users on the EU or humanitarian Kobo servers cannot save their server address at all. Fix the honesty problems first (days of work), then rebuild the review queue around "Needs review" (a week, mostly frontend — the backend filter already exists).

**Top 5 themes**
1. **The review loop is not built around the flagged queue** — no flagged filter, reason below the fold, no auto-advance, stale lists (F-01–F-04, F-36).
2. **Numbers that invite wrong decisions** — Field Team semantics, counts that disagree between screens, raw codes and jargon (F-08–F-12).
3. **Silent failures and invisible feedback** — failed pulls shown as success, save confirmations wiped, errors that vanish after 5 s, no data freshness (F-13–F-17).
4. **Setup friction** — unsavable Kobo server URL, no first-run path, hidden identifiers that silently disable checks, a settings page where saving one section saves another (F-18–F-25).
5. **Accessibility and layout** — 147 Tab presses to reach a decision, unlabelled fields on 7 screens, invisible focus, contrast failures, no detail pane below 768 px or at 200 % zoom (F-05, F-26–F-31).

**The 10 highest-leverage changes**

| # | Change (one line) | Findings | Effort |
|---|---|---|---|
| 1 | Never show a failed or partial Kobo pull as green; fix the AI-check crash that silently discards flags | F-13 (+ backend bug) | S |
| 2 | Save the Kobo server with the token ("Save connection"), with a Global / EU / Humanitarian / Other picker | F-18 | S |
| 3 | Field Team: rename "Validated" to "Approved by reviewer", drop "Top performer", then rank by flag rate | F-08 | S → M |
| 4 | Add a **Needs review · Reviewed · All** switch to the queue (uses the existing `qa_status=FLAGGED` filter) and a sort | F-01 | S |
| 5 | Put a "Why flagged" block (issue, value, threshold) directly above the decision buttons | F-02 | S–M |
| 6 | After a decision, drop the item from the filtered list and open the next one, with Undo and scoped A/N/H, J/K keys | F-03 | S |
| 7 | Settings: save only the section being saved, and show "Saved hh:mm" inside that section; errors never auto-hide | F-21, F-15 | S |
| 8 | Data Quality: remove the false "click to filter" hint and show human issue labels now; wire bars to the issue filter next | F-09, F-12 | S |
| 9 | Handle expired sessions everywhere with a sign-in dialog that keeps the user's place; "Try again" reloads, not re-pulls | F-35 | S |
| 10 | First-run: per-view empty states, "Connect Kobo" inline on Create, keep the draft; then a 3-step setup checklist | F-19 | S → M |

Foundations that make the rest cheaper: a small token set + 8 shared components (F-33), and URLs for views and submissions (F-32).

**Validate with real users first**
- Whether auto-advance after a decision should default on (F-03) — watch 3 reviewers do 15 decisions each.
- Which enumerator signals field coordinators actually act on (F-08 option B) — 3 short interviews.
- The "recommended" default check set for new surveys (F-23) — owner decision plus 2 pilot surveys.
- How often real XLSForms deviate from `today` / `start` / `end` naming (F-20).
- Whether reviewers work mostly on desktop, or on tablets in the field (F-05 priority).

---

## 2. Scope, method, evidence tier, limitations

### The brief's missing sections
The task brief referred to `how_to_observe`, `leads_to_verify` and journeys `J1–J9`, but those sections were not included in the message and do not exist in the repository. I therefore (a) chose an observation method myself (below), (b) **defined J1–J9 from the product's own flows** (§4), and (c) treated the hypotheses I formed while reading the code as the leads list and resolved each (table below). If the original J1–J9 or leads differ, the owner should map them onto these — most likely they overlap heavily.

### Method
1. **Orient** — read every file in `frontend/` (≈16 k lines), the relevant backend routers and ETL, code comments and git history for design intent → [`00-inventory.md`](00-inventory.md).
2. **Observe** — ran the real app locally: FastAPI backend + Vite frontend + disposable PostgreSQL 16 cluster + Redis + Celery worker. Kobo and OpenAI were replaced by a local mock ([`fixtures/mock_services.py`](fixtures/mock_services.py)) serving a synthetic bilingual household form (18 questions) and **147 synthetic submissions** with planted problems (a rushing enumerator, weekend work, outliers, gibberish answers, missing enumerators, an off-list district). Two throwaway accounts (owner, viewer).
3. **Walk J1–J9** with Playwright (Chromium 1194), recording every interaction, timings, DOM measurements and screenshots.
4. **Measure** — axe-core 4 (WCAG 2.0/2.1/2.2 A+AA rules) on 13 screen states, computed-style crawl for the design-system inventory, contrast ratios computed from computed colours, Tab-count scripts, reflow at 320/390/720(=200 % zoom)/1024 px, dark mode.
5. **Synthesize → prioritize → adversarial review** (§7, §9; the adversarial notes are summarised in §9.2).

### Evidence tier reached
**Tier: running application, synthetic data, mocked integrations + source.** Every finding is tagged [OBSERVED] (seen in the running app), [CODE] (read in source) or [INFERRED]. No findings rest on [INFERRED] alone.

### Limitations (what I could not observe)
- **No real users**, no usage analytics, no production data. Severity is my judgment of consequence, not measured frequency.
- **Kobo and OpenAI were mocked.** Real Kobo latency, pagination limits, Enketo edit links and real LLM output quality were not observed. The mock returns plausible shapes taken from the code.
- **Scale:** 147 submissions. Behaviour at thousands (F-36) is inferred from measured request patterns.
- **Environment adjustments I made** (none to application code): Celery "eager" mode first, then a real worker; the worker needed `PYTHONPATH=backend` in my shell (could not verify whether Docker needs the same — its `WORKDIR` likely covers it). One run with eager mode left AI statuses stuck at "pending"; I reset them in the disposable DB. To get past the backend crash in F-13 I stored the don't-know codes in the legacy single-string shape via the API.
- **One outbound call** was attempted by the backend's "Test Connection" to `kf.kobotoolbox.org` with a synthetic token while I verified F-18; the sandbox proxy blocked it. No other external calls were made.
- **Screen readers** were not used; assistive-technology behaviour is inferred from DOM semantics and axe.
- **No mobile devices**; narrow layouts were emulated.
- Frontend dependencies: `xlsx` is pinned to a CDN tarball the sandbox could not reach; I installed `xlsx@0.18.5` from npm into `node_modules` only (not saved). The targets-file upload path was therefore exercised only in code reading.

### Leads (hypotheses from code reading) and their resolution

| # | Lead | Resolution | Evidence |
|---|---|---|---|
| L1 | Kobo API URL cannot be saved from its own section | **Confirmed** | J1, F-18 |
| L2 | Saving one settings section persists other sections' unsaved edits | **Confirmed** | J8 leak test, F-21 |
| L3 | Settings success messages are cleared by the reload after save | **Confirmed** | J8, F-15 |
| L4 | Issue-frequency bar click does not filter | **Confirmed** | J5, F-09 |
| L5 | Interview date / start / end identifiers have no editor | **Confirmed** | grep + J2 API read-back, F-20 |
| L6 | Detail pane hidden below 768 px | **Confirmed** (also at 200 % zoom) | reflow runs, F-05 |
| L7 | Data services ignore 401 | **Confirmed** | J9, F-35 |
| L8 | Checkbox label text does not toggle the box | **Confirmed** | J8, F-27 |
| L9 | "Survey deleted" confirmation never visible | **Confirmed** | leads run, F-15 |
| L10 | Create-survey draft lost when leaving the page | **Confirmed** | leads run, F-19 |
| L11 | Field Team "Validated" ≠ its definition | **Confirmed** | progress.py:580, 24.5 % = 36/147, F-08 |
| L12 | Kobo outage reported as success | **Confirmed** | J3, F-13 |
| L13 | ↓ after using the status menu re-opens the menu instead of moving on | **Refuted** — focus returns to `<body>` and ↓ moves to the next list item | J4 |
| L14 | Keyboard users must tab through the whole list to reach the detail | **Confirmed** (147 Tabs) | tabcount, F-26 |
| L15 | A "Not Reviewed"-filtered list goes stale after a decision | **Confirmed** | J4, F-03 |
| L16 | Filter chips nest a `<button>` in a `<button>` | **Confirmed** (React DOM warning) | J4 console, F-30 |
| L17 | Queue downloads all submissions twice | **Confirmed** in requests; impact at scale **unable to verify** | reqs run, F-36 |
| L18 | An AI check can stay "in progress" forever | **Partially confirmed** — observed after a job loss in this environment; production frequency unknown | F-17 |
| L19 | Cross-page navigation can apply a hidden `qaStatuses` filter the UI cannot show | **Refuted** — no caller passes `qaStatuses` | grep |
| L20 | Viewers see actions they cannot perform | **Confirmed** | J9, F-34 |
| L21 | AI findings change a submission's review status | **Refuted** — the worker never updates `qa_status` (3 AI-only submissions stay "pending approval") | DB query, F-10 |
| L22 | Dark mode is broadly usable | **Confirmed** with one contrast failure on Field Team | kbd run, F-29 |

---

## 3. Model of the product and users (please correct), and proposed design principles

### What I believe the product is
A web companion to KoboToolbox for **high-frequency checks during fieldwork**. Data is pulled from Kobo on demand, checks run server-side, and reviewers set each submission's Kobo validation status (Approved / Not Approved / On Hold) from Field Compass, which writes it back to Kobo. Dashboards summarise quality, collection progress against targets, and enumerator performance. Audience, per the marketing site (`site/index.html`): "humanitarian and development organisations"; the site promises reviewers can "follow up with your field teams… while the enumerator is still in the area" and "compare interview duration, flag rates and output per enumerator, so retraining goes to the people who actually need it".

### Users I designed for
| Role | Main job | Frequency | Context | Screens |
|---|---|---|---|---|
| **Reviewer / data-quality officer** | Clear today's flagged submissions; call back enumerators | Daily, 1–3 h sessions during fieldwork | Laptop, often in a field office with a patchy connection | Submissions (90 %) |
| **Field coordinator / supervisor** | Decide which enumerator needs follow-up or retraining | Daily–weekly | Laptop or tablet | Field Team → Submissions |
| **Survey owner / M&E lead** | Connect a Kobo project, set targets and checks, report progress | Setup + weekly | Laptop | Create, Settings, Progress, Data Quality |
| **Viewer** (manager, donor, partner) | Read progress and quality | Weekly | Any device | Progress, Data Quality |

Owner values visible in code comments and commits, which this review keeps: *nothing is selected or guessed on the user's behalf* (SurveyContext, identifier suggestions), *unset is a valid configuration, not an error* (targets, enumerator), *say less* (commit 30f4ac0), *an empty chart must explain itself* (CapabilityNotice).

### Proposed design principles
1. **Queue first.** Every summary screen ends in "these submissions need you" — a filtered, linkable queue.
2. **Numbers reconcile.** One glossary of counts (Pulled, With issues, Needs review, Approved) used verbatim everywhere; any exclusion is footnoted.
3. **Nothing fails or succeeds silently.** Every pull, save and decision leaves a visible, persistent outcome in the place the user is looking.
4. **Evidence beside the decision.** The reason for a flag sits next to the approve / reject control.
5. **People's words, not the pipeline's.** Choice labels over codes, "Pull new submissions" over "ETL", issue names over check IDs.
6. **Visible guesses only.** Anything inferred (identifiers, don't-know codes, recommended checks) is shown and editable — the owner's existing rule, applied everywhere.
7. **Field-ready.** Works by keyboard, at 200 % zoom and on a tablet, because reviewers work long sessions on imperfect hardware.

---

## 4. Journey analyses (J1–J9)

Journeys were defined from the product's own flows (see §2). "Interactions" counts clicks, typed fields and selections performed by the Playwright script; scrolling and reading are noted separately. Raw logs: scratch `j1…j9.json` (summarised here); screenshots in `screenshots/`.

**Summary**

| # | Journey | Primary user | Outcome | Interactions (measured) | Worst friction | Key findings |
|---|---|---|---|---|---|---|
| J1 | First run: register → connect Kobo | New survey owner | ⚠ Blocked for non-default Kobo servers | 12 (kf default) · 15 + a workaround (EU/humanitarian) | Server URL cannot be saved | F-18, F-19, F-31 |
| J2 | Create a survey from a link → first data | Survey owner | ✓ Works | 13 as walked · 6 minimum | First pull looks clean (3/147 flagged) | F-20, F-23, F-10, F-12 |
| J3 | Pull new data and know what changed | Reviewer | ✗ Misleading on failure | 1 | Kobo down shown as green success | F-13, F-14, F-16 |
| J4 | Daily review of flagged submissions | Reviewer | ⚠ Works, slowly | 3 clicks + scroll + scan per decision; 147 Tabs by keyboard | No flagged filter; reason below fold | F-01–F-04, F-26, F-28 |
| J5 | Data Quality → the submissions behind a problem | Data manager | ⚠ Status drill works; issue drill doesn't | 2 (status) · impossible (issue) | "Click a bar to filter" does nothing | F-09, F-12, F-26 |
| J6 | Find an enumerator to follow up | Field coordinator | ✗ Steered to the wrong people | 2 to an enumerator's submissions | Ranking = review progress | F-08, F-11 |
| J7 | Progress against targets | Owner, viewer | ✓ Works | 2 | 137 vs 147 unexplained | F-10, F-29 |
| J8 | Configure and tune quality checks | Survey owner | ⚠ Works with hidden side effects | 34 for the set walked | Unsaved edits saved by another section; no confirmations | F-15, F-21, F-22, F-24, F-27 |
| J9 | Share with a colleague; viewer; session expiry | Owner, viewer | ⚠ Sharing works; viewer and expiry poor | 4 to share | Viewer hits raw 403s; expiry not detected | F-34, F-35, F-15 |

### J1 — First run: register, connect Kobo
*Goal:* a new owner on `eu.kobotoolbox.org` gets to "connected". *Entry:* marketing site → `#register`.

| # | Action | Screen | Int. | Observation | Evidence |
|---|---|---|---|---|---|
| 1 | Register tab, fill 5 fields, Create account | S0 | 7 | Clear, labelled form; no `autocomplete` hints. | j1-01/02; F-31 |
| 2 | Land in the app | S1 | – | "No survey selected — Please select a survey from the sidebar to view its settings." while the sidebar says "No surveys yet." No next step. | j1-03; F-19 |
| 3 | New survey, name, paste link | S6 | 3 | Link parsed instantly ("✓ Project ID"), then red "Add your Kobo API key in user settings…" with no link. | j1-04; F-19 |
| 4 | User menu → Account Settings | S7 | 2 | The typed survey draft is discarded (verified: name empty on return). | leads run; F-19 |
| 5 | Edit "Kobo API URL" | S7 | 1 | No Save button appears for this field. | j1-05; F-18 |
| 6 | Paste token → Save Token | S7 | 2 | Token saved; server URL on the server is still `kf.kobotoolbox.org`; field reverts on reload. | j1-06; F-18 |
| 7 | Test Connection | S7 | 1 | Tests the default server ("Could not connect to Kobo API at https://kf.kobotoolbox.org/api/v2"). | j1-07; F-18 |
| 8 | Workaround: edit Full name + Save Changes, Test | S7 | 3 | Only now is the URL saved; test passes. A real user would not find this. | j1-08; F-18 |

**Result:** 12 interactions for a default-server user, plus learning the prerequisite from an error. Non-default servers: blocked without the workaround.

### J2 — Create a survey from a Kobo link, get first data

| # | Action | Screen | Int. | Observation | Evidence |
|---|---|---|---|---|---|
| 1 | New survey, name, paste link | S6 | 3 | Form auto-read in < 1 s: "✓ Household Resilience Survey 2026 (synthetic) (18 questions)"; language picker appears (bilingual form). Excellent. | j2-01 |
| 2 | Form check auto-runs | S6 | 0 | "0 to fix, 5 worth fixing… across **14** questions" (vs 18 above). | F-10 |
| 3 | Targets: "A target per answer", Group by district, 40 per group, Apply | S6 | 4 | Clear ladder of modes, "Apply to every group" and totals. Excellent. | j2-02 |
| 4 | Dates | S6 | 2 | Optional (documented decision, kept). | — |
| 5 | Identifiers | S6 | 0 | Enumerator and consent auto-filled and visible; `today`/`start`/`end` auto-filled **invisibly** (API read-back). | F-20 |
| 6 | Create Survey → "Configure Now" | S6→S5c | 2 | Yes/no modal; lands on Data Quality Checks with nothing pre-ticked. | j2-03/04; F-23 |
| 7 | Submissions | S1 | 1 | "No submissions match your filters." / "No submissions found." — no filters applied, data simply not pulled yet. | j2-05; F-19 |
| 8 | Refresh from Kobo | S1 | 1 | 3.4 s. "ETL completed: 147 fetched, 147 created, 0 updated, 147 checked, 3 flagged, 0 AI qualitative checks queued." | j2-07; F-12, F-23 |

**Result:** works; 13 interactions as walked, 6 minimum. The first impression ("3 flagged") is misleadingly clean.

### J3 — Pull new data and know what changed

| # | Situation | Observation | Evidence |
|---|---|---|---|
| 1 | Arrive on any data page | No indication of when data was last pulled. | F-14 |
| 2 | Normal pull | Green banner with pipeline jargon; "flagged" counts only re-checked items (a later pull said "1 flagged" while 67 submissions carried issues). | F-10, F-12 |
| 3 | Kobo unreachable | Green "ETL completed: 0 fetched, 0 created…" after 3.5 s on Submissions and Data Quality. | j3-01/02; F-13 |
| 4 | Pipeline crash (AI checks on + multiple DK codes) | API returned `errors: 146`; UI green "…43 flagged"; only 5 flags actually saved. | backend.log; F-13 |
| 5 | Pull as a viewer | Raw "ETL pipeline failed: 403…" and the queue replaced by the error. | j9-06; F-16, F-34 |

**Result:** one click, but in 3 of the 4 non-happy states the outcome is misread or destroys context.

### J4 — Daily review of flagged submissions (core loop)

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Select survey → Submissions | 1 | 147 rows; 67 have issues, 44 need review, scattered to position 144; 7 rows fit on screen (93 px each). | j4-01; F-01, F-04 |
| 2 | Open Filters | 1 | Only Validation status / Enumerator / district — no "has issues", no issue type, no sort. | j4-02; F-01 |
| 3 | Click a flagged row | 1 | Header "1 issue · Review 1 quality issue below"; first "Flagged" marker 856 px down a 606 px pane, after overview, notes and green "Passed" rows. | j4-03, state-detail-300193; F-02 |
| 4 | Status ▾ → Approve | 2 | Written to Kobo instantly; warning "has 1 quality issue but is marked as approved" appears *after*. Stays on the same item. | j4-05/06; F-02, F-03 |
| 5 | Reviewer note → Save notes | 2 | Saved (verified in DB). | — |
| 6 | Next flagged item | 1 + scan | Must scan the list again. ↓ moves to the next row (flagged or not). | F-03 |
| 7 | Filter "Not Reviewed", decide one | 4 | Decided item stays; count unchanged ("Showing 99"). | j4-09/10; F-03 |
| K | Keyboard only | – | 9 Tabs to the first row; **147 Tabs** from a selected row to its status control; focus ring invisible on rows. | F-26, F-28 |

**Result:** per decision ≈ 3 clicks + ≥ 1 scroll + a list scan; clearing 44 items ≈ 130 clicks and 44 scans. Keyboard review is impractical.

### J5 — From Data Quality to the problem submissions

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Data Quality | 1 | Status cards, metrics, issue frequency, trends. Issue names are check IDs; the 5th is truncated ("erview_out_of_office_hours"). | j5-01; F-12 |
| 2 | Click top bar (duration_too_short) | 1 | Opens Submissions unfiltered — 147 rows, no filter badge — despite "Click on a bar to filter submissions by that issue type". | j5-02; F-09 |
| 3 | Click "Not Approved" card | 2 | Works: 10 rows, filter badge "1" on the collapsed Filters button. Cards are `div`s — not reachable by keyboard. | j5-03; F-26 |
| 4 | "Last 7 days" | 1 | Works (41 submissions). | j5-04 |

### J6 — Find an enumerator to follow up

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Field Team | 1 | "Enumerators 9 active" (includes "Unknown"); "Team Validated 24.5 % approval rate"; "Top Performer enum_02 38.1 % validated"; every bar red "< 60 % validated". | j6-01; F-08, F-11 |
| 2 | Read the leaderboard | 0 | enum_07 — all 32 interviews 6–9 min and flagged — is #3 of "Top 5 Performers". | j6-01; F-08 |
| 3 | Sort by % Needs Review | 1 | "Unknown" (4 blank-enumerator submissions) is top. | F-11 |
| 4 | Survey Quality tab | 1 | Avg active time 6 min for enum_07 with ↑/↓ vs team — genuinely useful, but secondary. | j6-03 |
| 5 | Click enum_07 row | 1 | Submissions filtered to 32 (all flagged) — the drill-down works. | j6-04 |

### J7 — Progress against targets

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Data Collection Progress | 1 | Overall 137 / 160 = 85.6 %. 137 silently excludes 10 Not Approved. Title repeated twice (page header + card). | j7-01; F-10 |
| 2 | By district | 1 | Labels resolved ("Eastern"); off-list code "d_central 5 — —" shown honestly. % label on the bar 3.43:1. | j7-02; F-29 |
| 3 | Approved surveys only | 1 | Works (all districts drop to 17–25 %). | j7-03 |

### J8 — Configure and tune quality checks

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Settings → Data Quality Checks | 2 | Form check, then four sections with three different edit models. | j8-02; F-22 |
| 2 | Tick "weekends" (don't save); Outlier: Edit, tick flag + 3 variables, Save | 7 | No confirmation anywhere; the weekend tick was saved too. | j8-03; F-15, F-21 |
| 3 | General: 3 ticks + min duration 15 + Save | 5 | Clicking a checkbox's text does not toggle it. No confirmation. | j8-04; F-27, F-15 |
| 4 | AI checks: Edit, enable, pick field, Save | 4 | No confirmation. | F-15 |
| 5 | Custom: Edit, prompt, Generate, "Accept & Add to Editor" | 4 | Rule saved live; editor stays empty. | j8-06; F-24 |
| 6 | Suggest rules → Add Selected → Done | 3 | 3 rules saved live ("added to editor!"). | j8-07; F-24 |
| 7 | Submissions → Refresh | 2 | 43 flagged (was 3). Effect only after a manual pull. | j8-09 |

**Result:** 34 interactions; 5 saves, 0 visible confirmations, 1 unintended change committed.

### J9 — Share with a colleague; viewer experience; session expiry

| # | Action | Int. | Observation | Evidence |
|---|---|---|---|---|
| 1 | Settings → Access → unknown email → Share | 4 | "User with email … not found" at page top; gone after 5 s. | j9-02; F-15 |
| 2 | Colleague email → Share | 2 | Listed as Viewer, role dropdown + revoke. Clear one-line role explanation. | j9-03 |
| 3 | Viewer opens a submission | 2 | Status menu, Save notes, Refresh all enabled. Approve → "This action requires editor access or higher". | j9-05; F-34 |
| 4 | Viewer presses Refresh | 1 | "ETL pipeline failed: 403: …" and the list replaced by the error. | j9-06; F-16 |
| 5 | Token expires | 1 | "Failed to fetch submissions." / "Could not validate credentials — Try again" (which runs a full pull); still "signed in". | j9-08/09; F-35 |

---

## 5. Visual design and design-system audit

Method: computed styles of every visible element on 13 screen states (light mode, 1440×900), plus a source grep. Raw data: scratch `audit.json`.

### 5.1 Inventory (measured)

| Dimension | Measured | Comment |
|---|---|---|
| Text colours in use | **36** distinct (top: #111827 625, #4b5563 549, #1f2937 303, #374151 289, **#ca8a04 202**) | Four near-identical greys for body text; the fifth most used colour is the failing amber "n Issues". |
| Background colours | **33** | Card-in-card-in-card surfaces (gray-50 → gray-100 → white) on Progress/Create. |
| Font sizes | 10, 11, **12 (58 % of text nodes)**, 14, 16, 18, 20, 24, 30 px | Dense UI; 12 px is the body size of the queue and detail. |
| Font weights | 400 · 500 · 600 · 700 | Fine. |
| Corner radii | 4, 6, 8, 12, 16 px, full | Five radii for similar cards/buttons. |
| Button styles | **59** distinct (bg · size · weight · padding · radius · height) | Primary indigo buttons at heights 24, 28, 36, 38, 54 px; secondary buttons filled gray-600 (Cancel), bordered white, ghost indigo text; AI buttons purple/green gradients. |
| Headings | H1 = app name "Field Compass" (18 px) on every view; a second H1 only on Create/Account; H2 at 16/18/20 px; H3 at 14–20 px incl. an uppercase variant | No consistent scale; page titles are sometimes H2 in a grey bar, sometimes H1 in a card. |
| Custom Tailwind tokens | 1 (`gray-850`) | Everything else is raw palette utilities. |
| Colour utilities in source | **220** distinct; **21** hard-coded hex colours (charts) | |
| Primary-button class strings | **23** variants of `bg-indigo-600 …` | |
| Copy-pasted components | 8 inline spinner SVGs; 4 "Refresh from Kobo" headers with 4 different result strings; 3 multi-select/indicator dropdown implementations | Why many findings recur 3–4× (F-13, F-16). |
| `<label>` without `htmlFor` | 58 (17 with) | F-27. |
| ARIA | 22 `aria-*` attributes in the whole app; roles used: alert, status, switch, tooltip (1 each) | F-30, F-31. |

### 5.2 Token findings

1. **Status colours carry meaning but are not tokens.** Approved = green-100/800 (list pill) vs green-50/700 bordered (dropdown) vs green-600 (card numbers) vs #22c55e (chart line) vs #10b981 (Field Team bars). "Warning" is yellow-600 in the list, amber-600 in the detail, orange-700 for failed checks, amber-50 banners. Define `status.approved / notApproved / onHold / notReviewed` and `signal.issue / ok / info` once, with contrast-checked text/background pairs (values in F-29).
2. **Secondary text is too light in three places** (gray-400 on white 2.53:1, opacity-60 greys 3.28:1, amber on gray 2.37:1). A single `text-secondary = gray-600` (7.23:1 on gray-50) fixes most.
3. **Control boundaries** use gray-300 (1.47:1). `border-control = gray-500` (4.83:1) meets 1.4.11.
4. **Focus** has no token; `focus:outline-none` removes the browser default on queue rows (F-28). Add `focus-ring = 2 px indigo-600, 2 px offset`.
5. **Density:** 12 px body text in the two most-used panes, with 93 px list rows. Denser rows with 13–14 px text would show more items *and* be more legible (F-04).
6. **Charts** use hard-coded hex (`#6366f1`, `#9ca3af` axes, a 10-colour issue palette where "Total" and "Not reviewed" share `#6b7280`, `SubmissionStatusChart.tsx:6,10`). Chart tooltips use a fixed dark background in light mode (`IssueFrequencyChart.tsx:72`, `IssueTimeSeriesChart.tsx:147`, `SubmissionStatusChart.tsx:113`).
7. **Dark mode** (`darkMode: 'media'`, no toggle) is well covered — only one contrast failure measured (Field Team gray-500 on gray-800, 3.04:1).

### 5.3 Recommended minimum component set (F-33)

| Component | Replaces | Notes |
|---|---|---|
| `Button` (primary · secondary · danger · ghost × sm · md) | 59 styles | secondary = white + gray-500 border, not filled gray-600 |
| `Field` (label, control, help, error) | 58 unbound labels | extend existing `FormField`; checkboxes wrap their label |
| `Section` (title, actions, status line) | ~20 hand-built cards | hosts W4's inline "Saved hh:mm" |
| `Banner` (status / alert, never auto-hides errors) | `ErrorMessage`, `SuccessMessage`, 8 inline banners | `role` built in |
| `Dialog` | 4 hand-built modals | Headless UI `Dialog` (dependency already present) |
| `PageHeader` + `PullStatus` | 4 refresh headers | W5 |
| `Tabs` | `SubTabButton`, settings left nav, queue switch | proper `tablist` semantics |
| `Spinner` (sm · md) | 8 copies | 16 px inside buttons, 32 px for panes |

---

## 6. Accessibility audit — WCAG 2.2 Level A and AA

Method: axe-core (tags wcag2a/2aa/21a/21aa/22aa) on 13 screen states in light mode and 5 in dark mode; scripted keyboard traversal, focus-style reads, dialog behaviour, reflow at 320/390 px and 200 % zoom (720×450 CSS px); contrast computed from computed colours. **Not done:** screen-reader testing (NVDA/VoiceOver), text-spacing override, real devices. axe totals: colour-contrast on 13/13 screens; `label`/`select-name` (critical) on 7/13.

| SC | Level | Result | Instances / notes |
|---|---|---|---|
| 1.1.1 Non-text content | A | **Fail** | Data Quality charts (issue frequency, two time series) have no text alternative or data table; Field Team charts are backed by tables (pass). Icon buttons have `title`/`aria-label` (pass). |
| 1.2.x Time-based media | A/AA | N/A | No media. |
| 1.3.1 Info and relationships | A | **Fail** | 58 labels not bound to controls (F-27); settings sub-navigation and progress sub-tabs are plain buttons without tab semantics; clickable cards have no role. Tables use `<th>` (pass). |
| 1.3.2 Meaningful sequence | A | Pass | DOM order matches visual order. |
| 1.3.3 Sensory characteristics | A | Pass | Scatter quadrant legend uses arrows *and* words. |
| 1.3.4 Orientation | AA | Pass | No orientation lock. |
| 1.3.5 Identify input purpose | AA | **Fail** | Login/register/account password and email inputs have no `autocomplete` (F-31). |
| 1.4.1 Use of colour | A | **Fail** | Field Team bars and scatter dots encode the validation band by colour only (legend below); passes elsewhere (status pills have text). |
| 1.4.3 Contrast (minimum) | AA | **Fail** | 8 pairs: 2.37, 2.53, 2.66, 3.15, 3.28, 3.43, 4.27, 4.47 :1 (F-29); dark mode 3.04:1 on Field Team. |
| 1.4.4 Resize text | AA | **Fail** | At 200 % zoom on a 1440 px screen the submission detail never shows and the active nav tab is clipped (F-05). |
| 1.4.5 Images of text | AA | Pass | None. |
| 1.4.10 Reflow | AA | **Fail** | At 320 px: document 472 px wide, content column 64 px; detail pane hidden (F-05). |
| 1.4.11 Non-text contrast | AA | **Fail** | Input/select/checkbox borders gray-300 on white 1.47:1; focus ring transparent on queue rows (F-28, F-29). |
| 1.4.12 Text spacing | AA | Not verified | — |
| 1.4.13 Content on hover or focus | AA | Not verified | Recharts tooltips are hover-only; InfoTip is click-to-open with Esc (pass). |
| 2.1.1 Keyboard | A | **Fail** | 9 targets on Data Quality and 43 on Field Team unreachable (cards, bars, dots, sortable headers, ⓘ, rows) (F-26). |
| 2.1.2 No keyboard trap | A | Pass | No traps (dialogs leak focus instead — see 2.4.3). |
| 2.1.4 Character key shortcuts | A | Pass | None exist. Recommendation F-03 adds scoped, switch-off-able shortcuts to stay compliant. |
| 2.2.1 Timing adjustable | A | **Fail** | `ErrorMessage` and `SuccessMessage` auto-dismiss after 5 s by default; errors cannot be re-read (F-15). |
| 2.2.2 Pause, stop, hide | A | **Fail (conditional)** | While AI checks run, the queue re-fetches every 8 s with no way to pause (`Dashboard.tsx:156-169`). |
| 2.3.1 Three flashes | A | Pass | — |
| 2.4.1 Bypass blocks | A | Pass | `main` and `nav` landmarks exist (no skip link; recommended with F-26). |
| 2.4.2 Page titled | A | **Fail** | "Field compass" on every view (F-31). |
| 2.4.3 Focus order | A | **Fail** | Dialogs don't take focus and Tab leaves them; after selecting a submission, focus stays in the list (147 Tabs to the decision) (F-26, F-30). |
| 2.4.4 Link purpose (in context) | A | Pass | — |
| 2.4.5 Multiple ways | AA | Not verified | Views are not URL-addressable pages; becomes a clear pass with F-32. |
| 2.4.6 Headings and labels | AA | Pass (with notes) | Headings are descriptive; H1 is the app name on every view. |
| 2.4.7 Focus visible | AA | **Fail** | Queue rows `focus:outline-none` → transparent outline (F-28). |
| 2.4.11 Focus not obscured (minimum) | AA | Not verified | No sticky overlays observed. |
| 2.5.1 Pointer gestures | A | Pass | — |
| 2.5.2 Pointer cancellation | A | Pass | — |
| 2.5.3 Label in name | A | Pass | — |
| 2.5.4 Motion actuation | A | N/A | — |
| 2.5.7 Dragging movements | AA | N/A | No drag interactions. |
| 2.5.8 Target size (minimum) | AA | **Fail** | ⓘ icons 13×16 px inside clickable sortable headers (Field Team, 5 instances); chip "×" 12×20 px inside the filter button. Isolated 16 px checkboxes/InfoTips pass via the spacing exception. |
| 3.1.1 Language of page | A | Pass | `lang="en"`. |
| 3.1.2 Language of parts | AA | Not verified | French form labels are shown without a `lang` attribute when that language is chosen. |
| 3.2.1 On focus | A | Pass | — |
| 3.2.2 On input | A | Pass | — |
| 3.2.3 Consistent navigation | AA | Pass | — |
| 3.2.4 Consistent identification | AA | **Fail** | "Try again" runs a full pull on Data Quality but reloads elsewhere; the Kobo status is "Approved" on Data Quality and "Validated" on Field Team; "Account Settings" (menu) opens "User Settings". |
| 3.2.6 Consistent help | A | N/A | No repeated help mechanism. |
| 3.3.1 Error identification | A | Pass (with notes) | Errors are described in text, but auto-hide (2.2.1). |
| 3.3.2 Labels or instructions | A | Pass (visual) | Visible labels exist; programmatic binding fails under 1.3.1. |
| 3.3.3 Error suggestion | AA | Pass | E.g. link parsing: "Open your project in Kobo and copy the address bar." |
| 3.3.4 Error prevention (data) | AA | **Fail** | Deleting a custom quality check is immediate, with no confirmation or undo (`StagedRulesList.tsx:39`); survey/account delete and access revoke are confirmed (pass). |
| 3.3.7 Redundant entry | A | **Fail** | The Create-survey draft must be re-typed after going to settings to add the Kobo key (F-19). |
| 3.3.8 Accessible authentication (minimum) | AA | Pass | Password entry allows paste; no cognitive test. |
| 4.1.2 Name, role, value | A | **Fail** | Clickable `div`/`span`/`tr` without roles; filter multi-select lacks `aria-expanded`/`aria-haspopup`; `<button>` nested in `<button>` (filter chips); dialogs lack `role="dialog"` (F-30). |
| 4.1.3 Status messages | AA | **Fail** | Pull banners, "Showing n submissions" and save results are not live regions (F-31). |

**Tally (50 rows; the 1.2.x media criteria are grouped in one row):** 20 fail · 21 pass (3 with notes) · 5 not verified · 4 not applicable.

---

## 7. Findings catalog

36 findings, grouped by theme and ordered Now → Next → Later, then by severity. Severity: 4 = blocks a task or risks data loss / wrong decisions; 3 = major friction on a common task; 2 = minor; 1 = cosmetic. The same content is in [`findings.json`](findings.json) (generated from [`fixtures/build_findings.py`](fixtures/build_findings.py)).

### T1 The review loop is not built around the flagged queue

#### F-01 — Flagged submissions cannot be isolated in the review queue

**Type** Workflow · **Severity** 3 · **Scope** Local · **Priority** Now · **Confidence** High · **Effort** S→M

**Where** `S1 Submissions — components/SubmissionFilters.tsx:369-420 (only Validation status, Enumerator, Sampling filters)`; `components/Dashboard.tsx:304 (list column, no sort control)`

**Evidence**
- [OBSERVED] 147 submissions, 67 with issues, 44 needing review, scattered at list positions 1…144; 7 rows visible per 900 px screen (row height 93 px). Filters offered: Validation Status / Enumerator / district (j4.json; screenshots j4-01-queue.png, j4-02-filters-open.png).
- [CODE] Backend already supports `qa_status=FLAGGED` (backend/routers/submissions.py:171) and the frontend already serialises `FilterState.qaStatuses` (utils/filterUtils.ts:94-103) — but no control sets it.
- [OBSERVED] No way to filter by issue type; Data Quality's issue bars cannot drill down either (see F-09).

**Who / journeys** Data-quality officer / field supervisor doing daily review — J4, J5

**Why it matters** Triage starts from 'what needs my attention'. Today the reviewer scans 147 rows to find 44, every day, and cannot work one issue type at a time. Heuristics: recognition over recall; flexibility and efficiency of use.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Add a 'Needs review · Reviewed · All' segmented control above the list; Needs review sets qaStatuses=[FLAGGED] (+ validation_status=Not Reviewed). Default to Needs review when non-empty. Add Sort (Most issues first / Newest / Oldest). | S (frontend only, ~1 day) | Misses AI-only issues until the worker recomputes qa_status (3 of 44 in this dataset); On Hold semantics need a decision. | Makes F-03 auto-advance meaningful; gives Data Quality a target for drill-downs. |
| B | A + an 'Issue' single-select filter listing checks that fired, with counts and human labels; backend `issue_check` param on /api/submissions (jsonb containment). | M (frontend + ~20 lines backend) | Needs label dictionary (F-12). | Unblocks F-09 drill-down and per-issue batch review. |
| C | Separate 'Review inbox' page listing only flagged items with batch actions. | L | Duplicates the Submissions page; two places to decide. | Batch approve. |

**Recommendation** A now, B next. A is almost free because the backend filter already exists; B is the shared foundation for F-09. C adds a second place to take the same decision.

**Success signal** From opening Submissions to the first flagged, unreviewed submission in ≤ 1 click (today: scan up to 144 rows). 'Needs review' count matches the Data Quality 'needs review' figure.

#### F-02 — The reason a submission was flagged is below the fold and not named next to the decision

**Type** IA/Navigation · **Severity** 3 · **Scope** Local · **Priority** Now · **Confidence** High · **Effort** S–M

**Where** `S1 detail — components/SubmissionDetail.tsx:461-519 (action row + generic warning)`; `SubmissionDetail.tsx:49-65 (checks rendered in definition order, passes first)`; `SubmissionDetail.tsx:651-1244 (General → Custom → Qualitative → Outlier sections)`

**Evidence**
- [OBSERVED] Detail content 2 125 px in a 606 px pane (3.5 screens); first 'Flagged' marker 856 px from the top, i.e. not visible without scrolling (j4.json; j4-03-detail-top.png).
- [OBSERVED] Header says '1 issue' and 'Review 1 quality issue below before validation' but never which one; the first things below are green 'Missing UUID — Passed', 'Missing Enumerator — Passed', 'Date Out Of Range — Passed' (state-detail-300193.png).
- [CODE] Approving a flagged submission shows a warning only after the fact (SubmissionDetail.tsx:508-512).

**Who / journeys** Reviewer — J4

**Why it matters** The decision (approve / not approved / hold) depends entirely on why the item was flagged. Making the reviewer scroll past passed checks to find it costs time on every item and makes it easy to approve without reading. Heuristics: visibility of system status; recognition over recall; aesthetic and minimalist design (passes are noise at decision time).

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Order every check list failures-first and collapse passed checks into one line per section ('6 passed ▸'). | S | Still below the overview and notes (~300 px down). | — |
| B | Add a 'Why flagged (n)' block directly under the header, above the overview: one line per issue with label, value and threshold ('Duration too short — active 6 min, minimum 15 min'), each linking to its detail card. Keep A for the sections below. | S–M | Must derive a one-line summary per check type (most already have `message`). | Enables keyboard-only review with F-03 shortcuts. |
| C | Move the whole check area to a right-hand column next to the answers. | M | Cramped under 1 280 px; conflicts with F-05 narrow layout. | — |

**Recommendation** B (includes A). It puts the evidence and the decision in one glance without redesigning the page (wireframe W1).

**Success signal** On a flagged submission at 1440×900, every issue's name and value is visible without scrolling, next to the status control.

#### F-03 — After a decision the reviewer stays put, and the filtered queue goes stale

**Type** Interaction · **Severity** 3 · **Scope** Local · **Priority** Now · **Confidence** Med (validate with: Watch 3 reviewers do 15 decisions each with auto-advance on vs off; count re-opens/undos.) · **Effort** S

**Where** `components/Dashboard.tsx:217-222 (handleSubmissionUpdate only patches the item)`; `components/ValidationStatusDropdown.tsx:90-95`

**Evidence**
- [OBSERVED] After 'Approve', the detail still shows the same submission; moving on requires finding the next flagged row by hand (j4-06-after-approve.png).
- [OBSERVED] With the list filtered to 'Not Reviewed', putting #300240 On Hold left it in the list and the count stayed 'Showing 99 submissions' (j4-10-onhold-in-not-reviewed.png).
- [OBSERVED] ↓ after using the menu moves to the next *list* item (not the next flagged one) — the only keyboard shortcut.

**Who / journeys** Reviewer — J4

**Why it matters** Each decision costs 3 clicks + a scan. With 44 items that is ~130 clicks and 44 scans per session, and the stale list makes 'am I done?' unanswerable. Heuristics: efficiency of use; match between list state and reality.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | After a successful status change: remove the item from a list whose filter it no longer matches (optimistic), open the next item, show an 8 s 'Approved #300246 · Undo' toast (role=status). | S | Accidental advance; mitigated by Undo and a per-user toggle. | Pairs with F-01 Needs review. |
| B | A + keyboard shortcuts A / N / H to decide and J / K to move, active only while focus is in the queue or detail, with a 'Keyboard shortcuts' toggle (WCAG 2.1.4). | S | Shortcut collisions with browser/AT if not scoped. | Fast expert review. |
| C | Batch selection with bulk approve. | M | Encourages approving flagged items unread. | — |

**Recommendation** A + B. Keep auto-advance as a toggle defaulting on (Undo covers mistakes); do not add bulk approve for flagged items.

**Success signal** Median interactions per decision on flagged items ≤ 2 (today 3 clicks + scan); list count updates within 1 s of a decision.

#### F-36 — The queue downloads every submission twice on each survey switch

**Type** Perceived-performance · **Severity** 3 · **Scope** Local · **Priority** Next · **Confidence** Med (validate with: Load-test with 20k synthetic submissions.) · **Effort** M

**Where** `components/Dashboard.tsx:32-65 (fetchSubmissionsAcrossPages loops all pages)`; `Dashboard.tsx:68-82 (all, for filter options) + 85-114 (filtered)`

**Evidence**
- [OBSERVED] Selecting a 147-submission survey issued 14 API calls including 8 submission pages (dev StrictMode doubles effects; ≈4 in production) (reqs.js).
- [INFERRED] At 20 000 submissions that is ≈400 sequential 100-row requests per survey switch in production, plus a full re-page on every filter change; each response carries full submission_data.

**Who / journeys** Teams with large surveys — J4

**Why it matters** Perceived performance of the most-used screen degrades linearly with survey size. Heuristic: system response time.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Server-side pagination/virtualised list (page of 50, infinite scroll) and a lightweight list endpoint (id, enumerator, district, status, issue checks); fetch filter options from a /facets endpoint. | M | Backend work; keyboard nav across pages. | F-01 counts from `total`. |
| B | Keep client-side but fetch once and filter locally. | S | Memory; still O(n) download. | — |

**Recommendation** A.

**Success signal** Queue first paint < 1.5 s at 20k submissions on a 3G-class connection.

#### F-04 — Queue rows show the ID and time but not who, where, or what is wrong

**Type** Visual · **Severity** 2 · **Scope** Local · **Priority** Next · **Confidence** High · **Effort** S

**Where** `components/SubmissionListItem.tsx:26-40`

**Evidence**
- [OBSERVED] Row = 'ID: 300246 · Not Reviewed · Submitted: 9/28/2026, 3:52:02 PM · ⚠ 1 Issues' in a 237 px column; row height 93 px → 7 rows visible (j4-01-queue.png).
- [OBSERVED] '1 Issues' (plural bug); issue text colour #ca8a04 on #f3f4f6 = 2.66:1 and 2.37:1 when selected (audit.json).

**Who / journeys** Reviewer, supervisor — J4, J6

**Why it matters** Reviewers recognise work by enumerator and place ('Nadia's Eastern interviews'), and triage by issue type. Heuristics: recognition over recall; aesthetic and minimalist design.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Row = line 1 `#id · enumerator label · district · ⚠n`, line 2 = first two issue labels, line 3 = date + status pill; max 72 px; fix plural; amber-700 text (4.56:1). | S | Longer text in a narrow column truncates. | — |
| B | A + widen the list to 320 px at ≥1 280 px. | S | Less room for detail. | — |

**Recommendation** A (+B if the detail pane stays ≥ 800 px).

**Success signal** 9+ rows visible at 1440×900; a reviewer can say which enumerator a row belongs to without opening it.

#### F-06 — An 'Edited' badge appears but the edit history cannot be viewed

**Type** Feature-gap · **Severity** 2 · **Scope** Local · **Priority** Later · **Confidence** Med (validate with: Ask reviewers how often edited submissions matter in their workflow.) · **Effort** S–M

**Where** `components/SubmissionDetail.tsx:445-450`; `components/HistoryViewer.tsx (no importers)`; `services/api.ts getSubmissionHistory (unused)`

**Evidence**
- [CODE] HistoryViewer and api.getSubmissionHistory exist but nothing renders them (grep: no importers).

**Who / journeys** Reviewer investigating suspected data fabrication — J4

**Why it matters** An edited submission is exactly the one a reviewer wants to compare before/after. Heuristic: visibility; help users diagnose.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Make 'Edited' a button that expands the existing HistoryViewer inline. | S | Raw JSON-patch paths are unreadable; needs label mapping. | — |
| B | A + render changes as 'Question: old → new' using question labels. | M | — | — |

**Recommendation** B (A is a 1-hour stopgap).

**Success signal** From an edited submission, the reviewer sees what changed in ≤ 1 click.

#### F-07 — Every submission click makes a live Kobo call; when it fails the 'Edit in Kobo' button silently disappears

**Type** Perceived-performance · **Severity** 2 · **Scope** Local · **Priority** Later · **Confidence** High · **Effort** S

**Where** `components/SubmissionDetail.tsx:175-196, 466-487`; `backend/routers/submissions.py:336-405 (Kobo enketo call with 3 retries, 1 s + 2 s back-off)`

**Evidence**
- [OBSERVED] 'Loading…' pill on every selection (j4-03-detail-top.png); when the call failed (mock gap, then as viewer: 403) the button vanished with no message (j9 log).
- [CODE] KoboFetcher._make_request retries 3× with exponential back-off, so a slow Kobo adds ≥ 3 s per click.

**Who / journeys** Reviewer — J4

**Why it matters** Adds latency to every item and hides a capability without explanation. Heuristic: visibility of system status.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Fetch the Enketo URL on click of 'Edit in Kobo' (open a new tab to a small redirect endpoint); show an error toast if it fails. | S | One extra hop when editing. | — |
| B | Link to the Kobo data table URL already stored as `kobo_edit_url` (seen in DB) without Enketo. | S | Lands on the table, not the edit form. | — |

**Recommendation** A.

**Success signal** Zero Kobo calls on selection; a failed edit link shows a message.

### T2 Numbers that invite wrong decisions

#### F-08 — Field Team ranks enumerators by review progress while labelling it data quality

**Type** Content · **Severity** 4 · **Scope** Local · **Priority** Now · **Confidence** High (validate with: Confirm with the owner which enumerator signals field coordinators act on (Q5).) · **Effort** S→M

**Where** `components/progress-tracker/PerformanceDataView.tsx:12-13 (definitions)`; `backend/routers/progress.py:576-581 (validated = qa_status APPROVED)`; `components/progress-tracker/EnumeratorSummaryCards.tsx:20-26, 74, 88 ('approval rate', 'Top Performer')`; `components/progress-tracker/SubmissionsBarChart.tsx:38-42, EnumeratorLeaderboard.tsx:49-51`

**Evidence**
- [CODE] 'Validated' is counted when `qa_status == 'APPROVED'` — a reviewer approved it in Kobo — but the ⓘ says 'The number of surveys with no issues found.'
- [OBSERVED] 'Team Validated 24.5 % approval rate' = 36 approved / 147 (Data Quality shows Approved 36, 24.5 %). With 67 % unreviewed, every bar is red '<60 % validated' (j6-01-field-team.png).
- [OBSERVED] enum_07 — every interview 6–9 minutes, 32/32 flagged — is #3 in 'Top 5 Performers' by 'Validation Rate' (j567.json).
- [CODE] Leaderboard 'Active Time' ranks the longest as top 'for simplicity… most thorough' (EnumeratorLeaderboard.tsx:49-51).
- [CODE] The marketing site promises: 'Compare interview duration, flag rates and output per enumerator, so retraining goes to the people who actually need it' (site/index.html). The page shows no flag rate at all.

**Who / journeys** Field coordinator / project manager deciding whom to retrain, warn or praise — J6

**Why it matters** People decisions (feedback, retraining, contract renewal) are made from this page. It currently rewards enumerators whose work happened to be reviewed first and can put the worst enumerator on the podium. Heuristics: match between system and real world; error prevention.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Now: fix the words and colours only — rename 'Validated' → 'Approved by reviewer', 'Needs review' → 'Flagged, not yet approved', ⓘ texts to the real definitions; stop colour-coding approval rate; remove 'Top performer' card and medals; change the 'Active Time' leaderboard to show no winner. | S (copy + CSS) | Page still has no real quality ranking. | Stops the harm immediately. |
| B | Next: add Flag rate (≥1 issue / total, independent of review), Top issue, Median active minutes and DK rate per enumerator; sort 'Who to follow up with' by flag rate with a minimum-N rule; keep Approved as a grey progress column (wireframe W2). | M (backend loop already computes most inputs) | Needs agreement on which signals matter. | A defensible follow-up list. |
| C | Remove the Field Team page until B exists. | S | Loses the working drill-down to an enumerator's submissions. | — |

**Recommendation** A now, B next. C throws away a working drill-down.

**Success signal** Enumerators with 100 % flagged submissions never appear above ones with 0 %; every metric's ⓘ text matches its computation (spot-check 3 metrics against the API).

#### F-09 — Issue-frequency bars promise 'click to filter' but open the unfiltered list, labelled with raw check IDs

**Type** Interaction · **Severity** 3 · **Scope** Local · **Priority** Now · **Confidence** High · **Effort** S

**Where** `pages/QualityOverviewPage.tsx:35-41 (TODO, navigates without a filter)`; `components/quality-dashboard/IssueFrequencyChart.tsx:62-69 (Y-axis width 150), 102-106 (hint text)`

**Evidence**
- [OBSERVED] Clicking the top bar ('duration_too_short') opened Submissions with 'Showing 147 submissions' and no filter badge (j5.json; j5-02-after-issue-bar-click.png).
- [OBSERVED] Labels are check IDs ('qual_content_quality', 'outlier_livestock_count') and the fifth is truncated to 'erview_out_of_office_hours' (j5-01-data-quality.png).

**Who / journeys** Data manager — J5

**Why it matters** The page tells the user an action exists, then silently doesn't do it — the user may believe they are looking at the filtered set. Heuristics: consistency; error prevention; match with real-world language.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Now: remove the hint and pointer cursor until drill-down exists; show human labels (F-12 dictionary) with full text in a wider axis or wrapped labels. | S | Loses a promised (but broken) path. | — |
| B | Next: wire bars to the issue filter from F-01 option B (Submissions opens on 'Needs review', Issue = that check). | S after F-01B | Depends on backend issue filter. | Dashboard → evidence in one click. |

**Recommendation** A immediately (hours), B as soon as F-01B exists.

**Success signal** Bar click → list count equals that bar's affected-submissions count.

#### F-10 — The same quantity is counted differently on different screens, without explanation

**Type** Content · **Severity** 3 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S–M

**Where** `Dashboard.tsx:194-196 ('flagged' = qa_status FLAGGED among re-checked)`; `backend/routers/progress.py:262-265 (progress excludes Not Approved)`; `services/qualitative_worker_runtime.py (AI findings never update qa_status)`; `components/linter/FormLintPanel.tsx:273-277 vs CreateSurveyPage.tsx:615`

**Evidence**
- [OBSERVED] Pull banner said '43 flagged' while 67 submissions carried issues; a later pull said '1 flagged' (only re-checked items) (j8.json; API run log).
- [OBSERVED] Progress 'Interviews conducted 137' vs 147 everywhere else — Not Approved are silently excluded (j567.json; progress.py:262-265).
- [OBSERVED] 3 submissions whose only issues are AI findings stay 'pending approval' and are invisible to any FLAGGED-based count (DB query).
- [OBSERVED] Create page: 'Household Resilience… (18 questions)'; form check: 'across 14 questions' (j2.json).

**Who / journeys** Data manager reporting to donors / project leads — J3, J5, J7

**Why it matters** When two screens disagree, users stop trusting both, or report the wrong number upward. Heuristics: consistency and standards; visibility.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Define four named counts once (Pulled, With issues, Needs review, Approved) in a shared glossary and use them verbatim on every screen; add one-line footnotes where a view excludes something ('Excludes 10 Not approved'). | S–M | Copy work across 6 screens. | — |
| B | A + have the AI worker recompute qa_status after writing findings so 'Needs review' includes AI-only issues. | S backend | Changes Data Quality numbers retroactively. | Consistent Needs-review everywhere. |

**Recommendation** A + B.

**Success signal** For one survey, the 'Needs review' number is identical on the pull banner, the queue tab, Data Quality and Field Team.

#### F-11 — Enumerators appear as codes, and missing-enumerator submissions become a phantom 'Unknown' enumerator

**Type** Content · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S

**Where** `backend/routers/progress.py:573-574`; `components/progress-tracker/* (renders `id`)`; `SubmissionDetail.tsx:271-277`; `SubmissionFilters.tsx:384-395`

**Evidence**
- [OBSERVED] Field Team, filters and submission detail show 'enum_07'; the form's choice label is 'Nadia Rahimi' (j6-01-field-team.png; fixtures/mock_services.py FORM).
- [OBSERVED] 4 submissions with no enumerator form an 'Unknown' row counted in 'Enumerators 9 active' and top the '% Needs Review' sort (j567.json).
- [CODE] Commit fe7d552 removed the phantom-enumerator problem for *unconfigured* surveys ('worse than empty, because it reads as data'); it persists for configured surveys with blank values.

**Who / journeys** Field coordinator — J6, J4

**Why it matters** Coordinators think in names; codes force a lookup sheet. A phantom enumerator inflates team size and ranks. Heuristic: match with the real world.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Show choice labels (existing getChoiceLabel) with the code as secondary text wherever an enumerator is shown; move blanks to a separate 'No enumerator recorded (4)' link. | S | Free-text enumerator fields have no label (show value as-is). | — |
| B | Allow the owner to upload a roster (code → name, team) in settings. | M | Another thing to maintain. | Team-level views. |

**Recommendation** A.

**Success signal** No screen shows a bare enumerator code when the form has a label; 'Enumerators' count excludes blanks.

#### F-12 — Pipeline and check jargon ('ETL', check IDs, 'DK', 'HFC') is shown to field staff

**Type** Content · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S

**Where** `Dashboard.tsx:195, 277 ('ETL completed', 'Running ETL…')`; `IssueFrequencyChart.tsx (check IDs)`; `IssueTimeSeriesChart.tsx`; `QualityMetricsCards.tsx:50 ('Avg DK % / Submission')`; `PerformanceDataView.tsx:20 ('cleaning log issues')`

**Evidence**
- [OBSERVED] 'ETL completed: 147 fetched, 0 created, 147 updated, 147 checked, 43 flagged, 147 AI qualitative checks queued' (j2-07-etl-done.png).
- [OBSERVED] Issue names 'duration_too_short', 'qual_content_quality', 'outlier_monthly_income' in charts and legends.

**Who / journeys** Supervisors and reviewers who are survey experts, not data engineers — J2, J3, J5

**Why it matters** Heuristic: match between system and the real world. Commit 30f4ac0 ('Say less') shows the owner already prefers plain, short copy.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | One label dictionary (check id → short label → one-sentence explanation) used by charts, filters, detail and banners; 'Pull new submissions' instead of 'Refresh from Kobo'; banner copy per W5. | S | Dictionary must be maintained when checks are added (put it next to the check registry). | F-01B, F-09 |
| B | Serve labels from the backend with each issue. | M | Backend change. | Consistent labels in exports. |

**Recommendation** A; move to B when exports exist.

**Success signal** No raw check id or 'ETL' visible in the UI (grep of rendered text).

### T3 Silent failures and invisible feedback

#### F-13 — Failed or partial pulls from Kobo are reported as success

**Type** Feedback/States · **Severity** 4 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** S–M

**Where** `backend/etl/kobo_fetcher.py:140-142 (exception → break → empty list)`; `Dashboard.tsx:194-196, QualityOverviewDashboard.tsx:96-98, DataCollectionProgressPage.tsx:65-67, EnumeratorPerformancePage.tsx:63-69 (banners omit `errors`)`; `backend/etl/pipeline.py:282 vs 346 (flagged counted before a per-submission crash)`; `backend/utils/rule_versioning.py:93`

**Evidence**
- [OBSERVED] Kobo unreachable → after 3.5 s a green 'ETL completed: 0 fetched, 0 created, 0 updated, 0 checked, 0 flagged' on Submissions and Data Quality (j3.json; j3-01-refresh-kobo-down.png).
- [OBSERVED] With AI checks on and don't-know codes stored as a list (the shape the UI now writes), 146/147 submissions raised `AttributeError: 'list' object has no attribute 'lower'` (rule_versioning.py:93) and were rolled back; the API returned errors=146 and the UI showed a green '…43 flagged' while only 5 submissions actually carried issues (backend.log; DB query).
- [CODE] None of the four banner builders read `errors`.

**Who / journeys** Everyone who pulls data; especially reviewers deciding 'no new problems today' — J3, J8

**Why it matters** '0 fetched' reads as 'nothing new'; '43 flagged' reads as 'the checks ran'. Both are false. Wrong decisions follow: fieldwork continues unchecked, data is reported clean. Heuristics: visibility of system status; help users recognise and recover from errors.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Frontend: one shared PullStatus component (W5) that shows amber when `errors > 0` or when fetched == 0 and the backend reports an upstream error; plain-language copy with Try again / Check connection. | S | Needs backend to report upstream failure distinctly. | F-14 freshness strip. |
| B | Backend: kobo_fetcher raises (or returns partial + error flag) instead of silently breaking; pipeline returns `upstream_error`; fix the list/str bug in generate_llm_input_hash and isolate LLM-queue errors from deterministic results. | S–M | Partial pagination behaviour must be kept (partial data is still useful). | Trustworthy counts. |

**Recommendation** A + B together; B's DK bug is a data-loss defect and should ship first (suggested as a separate task — see §10).

**Success signal** With Kobo stopped, pressing Pull shows an amber 'Couldn't reach Kobo… nothing was updated' within 5 s; an ETL with errors > 0 never renders green.

#### F-15 — Save confirmations in Survey Settings are wiped instantly, and errors vanish after 5 seconds

**Type** Feedback/States · **Severity** 3 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** S

**Where** `pages/SurveySettingsPage.tsx:286-292 (loadSurveyConfig clears success)`; …:683-836 (every section save → setSuccess → loadSurveyConfig); `components/ui/ErrorMessage.tsx:17 (autoHide = true by default)`; `SurveySettingsPage.tsx:1042-1050 (messages rendered at page top)`; `SurveySettingsPage.tsx:854 + App.tsx:32-55 (delete success hidden by the survey gate)`

**Evidence**
- [OBSERVED] After saving the Outlier section, no success message exists anywhere on the page (boundingBox null; j8-03-after-outlier-save.png).
- [OBSERVED] Sharing with an unknown email: error shown at the page top, gone after 5 s (j9.json).
- [OBSERVED] After deleting a survey: 'No survey selected — Please select a survey from the sidebar to view its settings.' and no confirmation (leads.js).

**Who / journeys** Survey owners configuring checks — J8, J9

**Why it matters** Users cannot tell whether a change took effect, so they re-save, re-check or doubt the configuration. Timed-out errors are missed entirely by anyone who looked away or uses a screen magnifier. Heuristic: visibility of system status; WCAG 2.2.1 spirit.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Don't clear success in loadSurveyConfig; render confirmations/errors inside the saved section (role=status / role=alert); make ErrorMessage autoHide default false. | S | Messages accumulate unless cleared on next edit. | — |
| B | A + a toast region shared app-wide. | S–M | Toasts are easy to miss for magnifier users unless persistent. | Consistency. |

**Recommendation** A (part of W4).

**Success signal** After any section save, 'Saved hh:mm' is visible in that section until the next edit; no error disappears on a timer.

#### F-14 — There is no indication of how fresh the data is

**Type** Feedback/States · **Severity** 3 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S–M

**Where** `Dashboard.tsx:264-268 ('Last run: 3.0s' = duration)`; backend: no persisted last-pull time (grep: none)

**Evidence**
- [OBSERVED] On arrival no page shows when data was last pulled; after a pull, '✓ Last run: 3.0s' shows the pull's duration and disappears on navigation (j3.json).
- [CODE] README 'Next steps' lists an Airflow scheduler: pulls are manual only.

**Who / journeys** Reviewers and managers — J3, J4, J7

**Why it matters** With manual pulls, the age of the data is the first thing a reviewer needs ('did the evening uploads come in?'). Heuristic: visibility of system status.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Persist last successful pull time + counts per survey; show 'Last pulled 14:32 · 12 min ago' in a shared header strip on all four data pages (W5). | S–M | Schema change. | Scheduled pulls later. |
| B | A + scheduled pulls (e.g. hourly) with the strip showing 'Next pull 15:00'. | M–L | Kobo rate limits; background worker ops. | Removes a daily manual step. |

**Recommendation** A next; B when the scheduler is built.

**Success signal** Every data page answers 'how old is this?' without interaction.

#### F-16 — A failed pull replaces the submission list with an error message

**Type** Feedback/States · **Severity** 2 · **Scope** Local · **Priority** Next · **Confidence** High · **Effort** XS

**Where** `components/Dashboard.tsx:318-319`

**Evidence**
- [OBSERVED] As a viewer, pressing Refresh replaced the 147-row list with 'ETL pipeline failed: 403: This action requires editor access or higher' (j9-06-viewer-refresh.png).

**Who / journeys** Anyone whose pull fails — J3, J9

**Why it matters** A failed pull does not invalidate the data already on screen; hiding it blocks work. Heuristic: error recovery.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Split state: `listError` (the list could not load) renders in the list column; `pullError` (the refresh failed) renders only in the header banner (W5). The list stays usable. | XS | None significant. | W5 PullStatus. |
| B | Keep the list but dim it with an overlay 'Couldn't refresh — showing data from 14:32 · Retry'. | S | Overlay blocks interaction until dismissed; worse for keyboard users. | — |

**Recommendation** A. The data on screen is still valid; nothing should cover it.

**Success signal** After any failed pull the previous list remains visible and usable.

#### F-17 — An AI check that never finishes shows 'in progress' forever and keeps the queue polling

**Type** Feedback/States · **Severity** 2 · **Scope** Local · **Priority** Later · **Confidence** Med (validate with: Check production logs for jobs pending > 15 min.) · **Effort** S

**Where** `components/Dashboard.tsx:156-169 (8 s polling while any pending/running)`; `SubmissionDetail.tsx:958-969 ('Status: skipped' shown when AI is off)`

**Evidence**
- [OBSERVED] After a lost job, all 147 submissions stayed 'pending' across further pulls (dedupe skipped them); the queue would poll every 8 s indefinitely (DB + code). Triggered here by the review environment's eager-mode setup, not by production code — likelihood in production unknown.
- [CODE] With AI checks disabled every submission still shows a 'Qualitative Quality Checks — Status: skipped' box.

**Who / journeys** Reviewer — J4, J8

**Why it matters** Heuristic: visibility of system status; minimalist design (a disabled feature should not take space).

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Frontend: treat pending > 15 min as 'Stalled — Retry'; stop polling after 10 minutes without change; hide the AI section when the feature is off. | S | Threshold needs tuning; Retry needs an endpoint that re-queues one submission. | — |
| B | Backend: a periodic sweep marks jobs pending > 15 min as failed with `llm_last_error='timed out'`, so every client sees the same state; frontend only hides the section when AI is off. | S–M | Needs a scheduler (Celery beat). | Consistent status in exports and counts. |

**Recommendation** B if Celery beat is (or will be) running; otherwise A. Hiding the section when AI is off applies either way.

**Success signal** No submission shows 'in progress' for more than 15 min; AI section absent when disabled.

### T4 Setup and configuration friction

#### F-18 — The Kobo server URL cannot be saved, so users on non-default Kobo servers cannot connect

**Type** Workflow · **Severity** 4 · **Scope** Local · **Priority** Now · **Confidence** High · **Effort** S

**Where** `pages/UserSettingsPage.tsx:22-23 (isProfileDirty ignores the URL)`; …:54-58 (URL only sent by the Profile form); …:245 (Profile Save shown only when dirty); …:287-301 (URL field sits in the Kobo section); …:321-329 (token link hard-coded to kf.kobotoolbox.org)

**Evidence**
- [OBSERVED] Editing only 'Kobo API URL' shows no Save button; 'Save Token' left the server URL at https://kf.kobotoolbox.org/api/v2; after reload the field reverted. The URL persisted only after also editing Full name to make the Profile Save appear (j1.json; j1-05/06 screenshots).
- [OBSERVED] Test Connection then tested the default server (it reported 'Could not connect to Kobo API at https://kf.kobotoolbox.org/api/v2').

**Who / journeys** Every organisation on the EU server (eu.kobotoolbox.org), the humanitarian server (kobo.humanitarianresponse.info) or self-hosted Kobo — J1

**Why it matters** These users cannot connect at all without discovering an accidental workaround — a hard block at the first step. Heuristics: visibility of system status; user control.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Include the URL in the Kobo section's own save: rename 'Save Token' → 'Save connection', send PUT /users/me {kobo_api_url} and the token together, then auto-test. | XS–S | — | — |
| B | A + server picker (Global / EU / Humanitarian / Other) and a token link that follows the chosen server (W3-B). | S | Server list must be kept current. | Fewer typos in URLs. |

**Recommendation** B.

**Success signal** A new user on eu.kobotoolbox.org connects in ≤ 4 interactions (pick server, paste token, Save, auto-test) with no profile edit.

#### F-19 — First run has no path: empty states point to an empty sidebar and the Kobo prerequisite is found by error

**Type** Workflow · **Severity** 3 · **Scope** Systemic · **Priority** Now · **Confidence** High (validate with: Time 3 first-time users from sign-up to first review decision.) · **Effort** S→M

**Where** `App.tsx:45-54 (same copy on every view: '…to view its settings')`; `pages/CreateSurveyPage.tsx:636-638 (plain red error)`; `App.tsx:154-170 (views unmount → Create draft lost)`

**Evidence**
- [OBSERVED] New account lands on Submissions: 'No survey selected — Please select a survey from the sidebar to view its settings.' while the sidebar says 'No surveys yet.' (j1-03-first-landing.png).
- [OBSERVED] Create page shows 'Add your Kobo API key in user settings…' as red text with no link; going there via the user menu and back empties the form (j1-04; leads.js: name '' after round trip).
- [OBSERVED] Minimum path from sign-up to first data for a kf.kobotoolbox.org user: 12 interactions + discovering the key step; for other servers not possible without the F-18 workaround.

**Who / journeys** New users (beta partners onboarding) — J1, J2

**Why it matters** First-run friction decides adoption. Documented decision to keep: nothing is auto-selected (SurveyContext.tsx:48-55) — the fix below respects it. Heuristics: help and documentation; error prevention.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Copy + links: per-view empty-state copy; when there are no surveys show 'Add your first survey' with a button; the Create page error becomes 'Connect Kobo' opening the connection card in a dialog; persist the Create draft in sessionStorage. | S | — | — |
| B | A 3-step setup checklist as the no-survey empty state (W3-A): Connect Kobo → Add survey → Choose checks. | M | Needs design of 'recommended checks' (F-23). | Measurable activation funnel. |

**Recommendation** A now, B next.

**Success signal** A new user reaches 'first submissions visible' without an error message, in ≤ 10 interactions after sign-up.

#### F-21 — Saving one settings section also saves unsaved edits made in other sections

**Type** Interaction · **Severity** 3 · **Scope** Local · **Priority** Now · **Confidence** High · **Effort** S

**Where** `pages/SurveySettingsPage.tsx:648-681 (persistSurveyConfig writes all page state)`; …:796-810 (Outlier save)

**Evidence**
- [OBSERVED] Ticked 'Flag submissions on weekends' in General checks without saving, then saved the Outlier section: the server config then had flag_weekend=true and General showed no pending changes (j8.json 'LEAK TEST').

**Who / journeys** Survey owners — J8

**Why it matters** Changes the user did not intend to commit go live on the next pull and alter flags. Heuristic: user control and freedom; error prevention.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Build the saved payload from the last *saved* config plus only the saving section's slice. | S | Needs a per-section slice map. | W4. |
| B | One page-level Save with a summary of changed sections. | S–M | Conflicts with existing per-section habit. | — |

**Recommendation** A (W4 rules 2–3).

**Success signal** Repeat the leak test: flag_weekend stays false on the server.

#### F-20 — Interview date, start and end questions are chosen invisibly and cannot be changed

**Type** Feature-gap · **Severity** 3 · **Scope** Local · **Priority** Next · **Confidence** High (validate with: Ask 2–3 owners how often their forms deviate from start/end/today naming.) · **Effort** S

**Where** `pages/CreateSurveyPage.tsx:125-137 (auto-fill incl. date_interview/start_time/end_time)`; `CreateSurveyPage.tsx:792-828 and SurveySettingsPage.tsx:1561-1605 (only Enumerator, Consent, DK shown)`; `constants/coreIdentifiers.ts:42-61 (help text exists, unused)`

**Evidence**
- [OBSERVED] After creating a survey, the saved config had date_interview='today', start_time='start', end_time='end', none of which were shown on any screen (j2.json API read-back).
- [CODE] grep: no VariableDropdown for date_interview/start_time/end_time anywhere; the only editor for them (SurveySetupPage) was deleted as unreachable in 105f1b0.
- [INFERRED] A form naming its date question e.g. 'survey_date' gets no match; out-of-period, weekend, office-hours and form-based duration checks can be switched on in settings but never flag anything.

**Who / journeys** Survey owners with non-standard XLSForm names — J2, J8

**Why it matters** Checks the user turned on silently do nothing, and the data looks cleaner than it is. Heuristics: visibility; user control. Consistent with the owner's rule 'guess only when unambiguous' (241ebf4) — but a guess must be visible to be checked.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Show the three as VariableDropdowns (existing component, help text already written) in Core identifiers on both screens, with the Suggested group. | S | More fields on the create form. | — |
| B | A + disable/annotate each dependent check in Data Quality Checks when its identifier is empty ('Needs an interview date question — set it in General'). | S | — | Prevents silent no-op checks. |

**Recommendation** B.

**Success signal** Every identifier a check depends on is visible and editable; a check whose input is missing says so next to its checkbox.

#### F-23 — New surveys start with almost every check off, so the first pull looks clean

**Type** Workflow · **Severity** 3 · **Scope** Local · **Priority** Next · **Confidence** Med (validate with: Owner decision on the recommended set (Q6).) · **Effort** S–M

**Where** `pages/CreateSurveyPage.tsx:333-353 (no quality_checks in created config)`; `components/QualityCheckPromptModal.tsx (yes/no prompt)`

**Evidence**
- [OBSERVED] After creating a survey and pulling: '147 checked, 3 flagged'; quality_checks was null. After enabling six checks: 43 flagged (j2.json, j8.json).

**Who / journeys** New survey owners — J2, J8

**Why it matters** The first impression ('3 of 147 flagged') is the opposite of the truth, and the configure prompt is dismissible with 'Later'. Documented decision to respect: collection dates are optional (CreateSurveyPage.tsx:283-287).

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Offer a pre-ticked 'recommended set' in the create flow (duration limits blank until set, weekend + office hours, DK %, outliers on numeric questions the owner confirms), with a one-line explanation each. | S–M | Defaults may not fit every context (e.g. weekend days). | F-19B step ③. |
| B | After the first pull, if no checks are on, show 'Only 2 basic checks ran. Turn on recommended checks?' in the banner. | S | Still starts clean. | — |

**Recommendation** A; B as a safety net.

**Success signal** First pull on a new survey runs ≥ 5 checks unless the owner deliberately turned them off.

#### F-22 — Survey Settings mixes four different edit-and-save models on one page

**Type** Interaction · **Severity** 2 · **Scope** Local · **Priority** Next · **Confidence** Med (validate with: 5-person hallway test on the settings page.) · **Effort** M

**Where** `SurveySettingsPage.tsx (see 00-inventory.md §4)`; `Kobo Tool/Targets/Outlier/AI use Edit buttons; Profile/Identifiers/General are live; Custom checks save each rule; Access saves on change`

**Evidence**
- [OBSERVED] In one tab: General checks are always editable with Save-when-dirty; Outlier and AI need 'Edit' first; Custom needs 'Edit' then 'Done' and saves per rule (j8-02-quality-tab-initial.png, j8-05-custom-edit.png).

**Who / journeys** Survey owners — J8

**Why it matters** Users must relearn how saving works per card and miss that some changes are already live. Heuristic: consistency and standards.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Adopt W4: every card always editable for owners, own dirty state, own Save/Cancel, inline confirmation, unsaved-changes guard. | M | Accidental edits (mitigated by dirty marker + guard). | Removes F-21 class of bugs. |
| B | Keep Edit buttons everywhere (make General/Profile/Identifiers also Edit-gated). | S | Extra click per change. | — |

**Recommendation** A.

**Success signal** All settings cards behave identically; usability test: 5/5 owners correctly predict whether a change is saved.

#### F-24 — AI rule buttons say 'Add to Editor' but save live rules; rule delete has no confirm or undo

**Type** Content · **Severity** 2 · **Scope** Local · **Priority** Next · **Confidence** High · **Effort** XS–S

**Where** `components/rule-builder/AINaturalLanguageInput.tsx:206`; `AISuggestedRules.tsx:135 ('added to editor!')`; `SurveySettingsPage.tsx:934-981 (saves immediately)`; `rule-builder/StagedRulesList.tsx:39 (delete immediately)`

**Evidence**
- [OBSERVED] After 'Accept & Add to Editor' the manual editor stayed empty and the rule was already on the server (j8.json).

**Who / journeys** Survey owners — J8

**Why it matters** The label promises a review step that does not exist; the rule starts flagging on the next pull. Heuristics: match; error prevention.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Rename to 'Add rule' / 'Add 3 rules'; success text 'Rule added — it will run on the next pull'; delete → Undo toast. | XS | — | — |
| B | Actually load the AI rule into the manual editor for review before saving. | S | One more click. | Safer AI use. |

**Recommendation** B for single rules (AI output deserves a look), A for copy everywhere.

**Success signal** No AI rule is saved without the user seeing its conditions in the editor.

#### F-25 — Settings asks for a 'Kobo Asset ID' although creation deliberately asks for a project link

**Type** Content · **Severity** 1 · **Scope** Local · **Priority** Later · **Confidence** High · **Effort** S

**Where** `pages/SurveySettingsPage.tsx:1174-1191`; `pages/CreateSurveyPage.tsx:53-56 (documented reason: Kobo never shows 'asset ID')`

**Evidence**
- [CODE] Create page comment: "Kobo's own interface never shows the term 'asset ID'"; Settings labels the same field 'Kobo Asset ID' and accepts free text without re-reading the form.

**Who / journeys** Survey owners — J8

**Why it matters** Contradicts a documented team decision. Heuristic: consistency.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Use the same 'Kobo project link' field (parseKoboAssetId) in Settings and re-read the form on change. | S | — | — |
| B | Make the project read-only after creation (changing projects = new survey). | XS | Blocks legitimate project moves. | — |

**Recommendation** A.

**Success signal** Neither screen shows 'asset ID'.

### T5 Accessibility and adaptable layout

#### F-27 — Form labels are not connected to their fields (and clicking a checkbox's text does nothing)

**Type** Accessibility · **Severity** 3 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** S–M

**Where** 58 `<label>` elements without htmlFor across pages (grep); `SurveySettingsPage.tsx:1779-1800 etc. (checkbox + separate label)`; `VariableDropdown.tsx:43-46`; `UserSettingsPage.tsx:196-230`

**Evidence**
- [OBSERVED] axe 'label'/'select-name' (critical) on 7 of 13 screens: Settings General (4+3), Quality (10), Custom edit (10+2), Create (4), Account (4), Access (2), Data Quality (2) (audit.json).
- [OBSERVED] Clicking 'Flag submissions outside the collection targets' text did not toggle its checkbox (j8.json).

**Who / journeys** Screen-reader users; everyone (small 16 px checkbox is the only click target) — J1, J2, J8, J9

**Why it matters** WCAG 1.3.1, 3.3.2 and 4.1.2 fail; also a Fitts's-law problem for all users.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Use the existing FormField component (the only one that binds labels, aria-invalid, aria-describedby) for every input/select; wrap checkboxes in their label. | S–M (mechanical) | Touches many files. | Consistent error display. |
| B | Add ids/htmlFor in place without refactor. | S | Drift returns. | — |

**Recommendation** A.

**Success signal** axe reports 0 label/select-name violations; every checkbox toggles from its text.

#### F-28 — Keyboard focus is invisible on queue items and weak elsewhere

**Type** Accessibility · **Severity** 3 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** XS

**Where** `components/SubmissionListItem.tsx:15 (focus:outline-none, no replacement)`; SurveySettingsPage delete modal buttons (outline none)

**Evidence**
- [OBSERVED] Focused queue item: outline 'solid 2px rgba(0,0,0,0)', box-shadow none (kbd.json queueItemFocusStyle); nav buttons rely on the browser default.

**Who / journeys** Keyboard users — J4

**Why it matters** WCAG 2.4.7 Focus visible (AA) fails on the core list.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Global base style: `*:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px }` in index.css, and delete bare `focus:outline-none` (SubmissionListItem.tsx:15 and dialog buttons). | XS | Double rings where components already add `focus:ring-*`; remove those as touched. | F-33 focus token. |
| B | Per-component rings (`focus-visible:ring-2 ring-indigo-600`) added where missing. | S | Easy to miss new components; drift returns. | — |

**Recommendation** A — one rule covers every current and future control.

**Success signal** Every focusable element shows a ≥ 3:1 focus indicator (manual pass).

#### F-29 — Text and control boundaries fall below contrast minimums in eight places

**Type** Accessibility · **Severity** 2 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** XS–S

**Where** `SubmissionListItem.tsx:35 (#ca8a04)`; `Sidebar.tsx:223 (opacity-60 email)`; `Sidebar.tsx:157 (opacity-75 asset id)`; `ProgressBar.tsx:41`; `EnumeratorSummaryCards.tsx (text-gray-400 sublabels)`; SurveySettingsPage 'Tool configured' green-600; `LoginPage.tsx:83 (white on indigo-500)`; all inputs border-gray-300

**Evidence**
- [OBSERVED] Measured (axe + computed): '1 Issues' 2.37:1 (#ca8a04 on #e5e7eb) and 2.66:1 on #f3f4f6; Field Team sublabels 2.53:1; sidebar email 3.28:1; green-600 3.15:1; progress % 3.43:1; asset ID on selected 4.27:1; login tab 4.47:1; input borders 1.47:1 (non-text, 1.4.11).
- [OBSERVED] Dark mode: Field Team gray-500 on gray-800 3.04:1; other screens pass except the sidebar asset ID.

**Who / journeys** Low-vision users; anyone on a laptop in daylight (field offices) — J4, J6, J7

**Why it matters** WCAG 1.4.3 (AA) and 1.4.11 (AA) fail; the most important list signal ('n issues') is the least legible text on screen.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Swap classes in place: amber-700 #b45309 for the issue count (4.56:1; amber-800 #92400e 5.73:1 on the selected row), gray-600 for secondary text (7.23:1), gray-500 for Field Team sublabels (4.83:1), green-700 (4.8:1), progress % label outside the bar in gray-900 (14.33:1 on the track) or white on blue-600 (5.17:1), indigo-600 login tab (6.29:1), gray-500 input borders (4.83:1). | XS–S | Slightly heavier look; will drift again without tokens. | — |
| B | Define the semantic tokens first (text-secondary, signal-issue, border-control …, F-33) with the same values, then migrate usages. | S–M | Slower to ship the fix. | Prevents regressions; one place to tune. |

**Recommendation** A now (minutes per instance), folded into B when F-33 tokens land.

**Success signal** axe color-contrast = 0 on all 13 screens in light and dark.

#### F-05 — Below 768 px — including 200 % zoom on a laptop — selecting a submission shows nothing

**Type** Accessibility · **Severity** 3 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** M

**Where** `components/Dashboard.tsx:330 (`hidden md:block`)`; `components/Sidebar.tsx (fixed 256 px at every width)`; `App.tsx:198-219 (nav wraps)`

**Evidence**
- [OBSERVED] At 720×450 CSS px (1440×900 at 200 % zoom) and at 390/320 px the detail never appears after selecting (kbd.json reflow_*; reflow-zoom200-after-select.png, reflow-w390-queue.png).
- [OBSERVED] At 320 px the document is 472 px wide (horizontal scroll) and the sidebar leaves 64 px for content; at 200 % zoom the active nav tab is clipped.

**Who / journeys** Low-vision reviewers using zoom; supervisors on tablets or phones in the field — J4, J7

**Why it matters** WCAG 1.4.4 Resize text and 1.4.10 Reflow fail on the core task. Field supervisors in low-connectivity settings often have only a phone or tablet.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Under md: list and detail become two stacked views with a Back button (state-based, no router needed); sidebar collapses to an overlay drawer below lg. | M | Two layouts to test. | — |
| B | Same as A but as routes (depends on F-32). | M (after F-32) | Blocked on router work. | Deep links, browser Back. |

**Recommendation** A now-ish (Next), migrate to B when F-32 lands.

**Success signal** At 320 px and at 200 % zoom a reviewer can open a submission, read why it is flagged and decide, with no horizontal scroll.

#### F-26 — Keyboard users need 147 Tab presses to reach the decision; charts, cards and table rows are mouse-only

**Type** Accessibility · **Severity** 3 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S–M

**Where** `Dashboard.tsx:304-336 (list before detail in tab order)`; `StatusSummaryCards.tsx:14 (div onClick)`; `PerformanceDataView.tsx:23-25, 213-222, 241-245 (span/th/tr onClick)`; `EnumeratorLeaderboard.tsx:155-161`; `recharts bars/dots with onClick`

**Evidence**
- [OBSERVED] From a selected first queue item to its status control: 147 Tab presses (tabcount.js).
- [OBSERVED] Unreachable click targets with tabIndex −1: 9 on Data Quality (status cards, bars), 43 on Field Team (rows, sort headers, ⓘ icons, bars, dots, leaderboard rows) (audit.json).

**Who / journeys** Keyboard and switch users; fast expert reviewers — J4, J5, J6

**Why it matters** WCAG 2.1.1 Keyboard (A) fails. The review loop is effectively unusable without a mouse.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Add a 'Skip to details' link / move focus to the detail heading on selection; convert clickable divs/rows/th/spans to buttons (or add role/tabIndex/Enter handling); provide a table alternative to chart clicks. | S–M | — | F-03 shortcuts. |
| B | Roving tabindex for the queue (one Tab stop, arrows inside). | S | Needs ARIA listbox semantics. | Tab count to decision ≤ 3. |

**Recommendation** A + B.

**Success signal** ≤ 3 Tab presses from a selected queue item to the decision; every clickable element reachable and operable by keyboard (axe + manual).

#### F-30 — Dialogs and custom dropdowns lack dialog semantics, focus management and Escape

**Type** Accessibility · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S–M

**Where** `SurveySettingsPage.tsx:1053-1098 (delete survey)`; `UserSettingsPage.tsx:488-521 (delete account)`; `progress-tracker/InfoModal.tsx`; `QualityCheckPromptModal.tsx`; `SubmissionFilters.tsx:32-180 (MultiSelectDropdown), 100 (button nested in button)`

**Evidence**
- [OBSERVED] Delete-survey dialog: no role, focus stays on the page button, Escape does nothing, Tab leaves the dialog (kbd.json).
- [OBSERVED] Filter dropdown: no aria-expanded/aria-haspopup; Escape does not close; React warns '<button> cannot be a descendant of <button>' for chip × buttons (j4 console).

**Who / journeys** Keyboard and screen-reader users — J4, J8, J9

**Why it matters** WCAG 2.4.3, 4.1.2 fail; nested buttons are invalid HTML.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Use Headless UI Dialog and Listbox (already a dependency, used for the status Menu) for all four dialogs and the multi-select. | S–M | — | Consistent behaviour. |
| B | Hand-roll focus trap/Escape. | S | Re-implementing solved problems. | — |

**Recommendation** A.

**Success signal** All dialogs: focus moves in, Escape closes, focus returns; axe nested-interactive = 0.

#### F-31 — Page title never changes, status messages are not announced, login lacks autocomplete

**Type** Accessibility · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** XS

**Where** index.html:7 (title 'Field compass'); `Dashboard.tsx:290-299 and 3 other pages (banners without role)`; `LoginPage.tsx:115-188 (no autocomplete)`

**Evidence**
- [OBSERVED] Title 'Field compass' on every view (kbd.json titles).
- [OBSERVED] ETL banners and 'Showing n submissions' have no live region (audit DOM).
- [OBSERVED] Login inputs autocomplete=null (kbd.json).

**Who / journeys** Screen-reader users; password-manager users — J1, J3

**Why it matters** WCAG 2.4.2, 4.1.3, 1.3.5 fail.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Targeted fixes: set document.title in each view's effect ('Submissions · Household Resilience 2026 · Field Compass'); `role=status` on pull banners and the list count; autocomplete=email / current-password / new-password / username on auth forms. | XS | Titles must be kept in sync by hand in each page. | — |
| B | Derive titles and announcements centrally: the router (F-32) sets titles from route metadata, and the shared Banner/PullStatus components (F-33) carry live-region roles. | S (after F-32/F-33) | Waits on foundations. | No per-page upkeep. |

**Recommendation** A now (under an hour); let B replace it when the router and Banner exist.

**Success signal** Titles differ per view; NVDA announces pull outcomes; password managers fill login.

### T6 Missing foundations (URLs, tokens, shared components)

#### F-32 — Nothing has a URL: no deep links, no Back, no shareable submission

**Type** IA/Navigation · **Severity** 3 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** M

**Where** `App.tsx:15, 73-87 (view in useState + localStorage)`; `App.tsx:95-110 (window CustomEvents for navigation)`

**Evidence**
- [CODE] Views are component state; the selected submission and filters are not persisted anywhere.
- [INFERRED] A supervisor cannot send 'look at #300246' as a link; browser Back leaves the app; refresh drops the open submission and filters.

**Who / journeys** Reviewers collaborating with supervisors; anyone using Back — J4, J5, J6, J9

**Why it matters** Collaboration on specific submissions is central to QA ('can you check this one?'). Heuristics: user control and freedom; recognition over recall.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Introduce a router with /surveys/:surveyId/{submissions,quality,progress,team,settings} and /submissions/:id?status=&issue=; keep the 'nothing auto-selected' rule (the URL *is* an explicit choice). | M | Touches every page; migration of cross-page events. | F-05B, F-03 deep links, shareable filters. |
| B | Hash-based state for survey + submission only. | S | Half-measure; still no Back per view. | Links to submissions. |

**Recommendation** A as a foundation in the Next cycle.

**Success signal** Copying the address bar reopens the same survey, view, filter and submission for a colleague with access.

#### F-33 — No shared tokens or components: 59 button styles, 36 text colours, 9 font sizes, four copies of the refresh header

**Type** Visual · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** M

**Where** tailwind.config.js (one custom token); `frontend/**/*.tsx (220 distinct colour utilities, 23 primary-button class variants, 21 hard-coded hex colours, 8 inline spinner SVGs)`; `Dashboard.tsx / QualityOverviewDashboard.tsx / DataCollectionProgressPage.tsx / EnumeratorPerformancePage.tsx (4 refresh implementations)`

**Evidence**
- [OBSERVED] Computed-style crawl of 13 screens: 59 distinct button styles, 36 text colours, 33 backgrounds, radii 4/6/8/12/16/full, headings H2 at 16/18/20 px, 12 px text = 58 % of text nodes (audit.json).
- [CODE] Four ETL banner strings with different fields (e.g. only Dashboard mentions AI checks).

**Who / journeys** Everyone (inconsistency) and the maintainer (every fix is done 4×) — all

**Why it matters** Inconsistency is why several findings exist 4× (F-13, F-16). Heuristic: consistency and standards.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Define semantic tokens in tailwind.config (text-primary/secondary/warning, surface, border-control, focus) and 8 components: Button (primary/secondary/danger/ghost × sm/md), Field, Card/Section, Banner (status/alert), Dialog, Spinner, PageHeader (+PullStatus), Tabs. | M | Churn across files; do alongside feature work. | F-13, F-15, F-27, F-28, F-29, F-30. |
| B | Adopt a component library (e.g. Headless UI + a Tailwind kit) wholesale. | L | Visual regression; learning. | — |

**Recommendation** A, incrementally: build each component when the first finding that needs it is fixed.

**Success signal** ≤ 8 button styles and ≤ 12 text colours in the same crawl; one PullStatus component.

### T7 Permissions and session

#### F-35 — An expired session is not detected on data pages; 'Try again' launches a full pull

**Type** Feedback/States · **Severity** 3 · **Scope** Systemic · **Priority** Now · **Confidence** High · **Effort** S

**Where** `services/api.ts:43-80, progressApi.ts, qualityApi.ts (no 401 handling)`; `contexts/AuthContext.tsx:104-108 (only user endpoints log out)`; `QualityOverviewDashboard.tsx:123-135 ('Try again' → handleRefresh → ETL)`

**Evidence**
- [OBSERVED] With an invalid token: Submissions shows 'Failed to fetch submissions.' twice; Data Quality shows 'Could not validate credentials — Try again' (j9-08, j9-09). The app stays 'signed in'.
- [CODE] 'Try again' calls handleRefresh, which runs the whole Kobo pipeline, not a reload of the dashboard.

**Who / journeys** Everyone after 24 h (JWT_EXPIRE_MINUTES default 1440) — J9, J4

**Why it matters** Users see generic failures and retry pointlessly; the retry triggers an expensive pull. Heuristic: help users recognise and recover from errors.

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | One fetch wrapper for all services: on 401 open a 'Your session expired — sign in again' dialog that preserves in-page state (typed notes) and resumes. | S | — | — |
| B | Hard logout on 401 (as authFetch does). | XS | Loses unsaved notes/settings edits. | — |

**Recommendation** A (adversarial review: B loses work mid-review). Also make 'Try again' reload the dashboard, not run a pull.

**Success signal** With an expired token, the next action shows a sign-in prompt; after signing in the user is on the same view with typed text intact.

#### F-34 — Viewers see every action enabled and learn about their role from raw 403 errors

**Type** Interaction · **Severity** 2 · **Scope** Systemic · **Priority** Next · **Confidence** High · **Effort** S

**Where** `ValidationStatusDropdown usage in SubmissionDetail.tsx:490-495`; `SubmissionDetail.tsx:632-639 (Save notes)`; `Dashboard.tsx:269-287 (Refresh)`

**Evidence**
- [OBSERVED] As Viewer: status menu, Save notes and Refresh enabled; Approve → 'This action requires editor access or higher'; Refresh → 'ETL pipeline failed: 403: This action requires editor access or higher' and the list replaced (j9.json; j9-05, j9-06).

**Who / journeys** Viewers (donors, managers, partners) — J9

**Why it matters** Heuristics: error prevention; match (the Viewer badge is tiny and only in the sidebar).

**Options**

| Opt | Change | Effort | Risks | Unlocks |
|---|---|---|---|---|
| A | Pass `permission` to the Submissions and data pages; hide Refresh, render status as a read-only pill, disable notes with 'Viewers can read notes'. | S | — | — |
| B | A + a one-line role banner at the top of each survey for viewers. | S | Noise for frequent viewers. | — |

**Recommendation** A.

**Success signal** A viewer session produces zero 403 responses in normal navigation.

---

## 8. What's working well — preserve these

| What | Where | Why it matters |
|---|---|---|
| **Nothing is selected on the user's behalf**, but a refresh keeps your place (sessionStorage, cleared on login) | `SurveyContext.tsx:46-85`, `selectedSurveyStorage.ts` | Prevents editing or reporting on the wrong survey. Keep it when adding URLs (F-32): a URL is an explicit choice. |
| **Honest empty states** — "no targets" is a configuration, not an error; bars show "—" rather than 0 % or 100 % | `ProgressDataView.tsx:30-38, 229-240`, `ProgressBar.tsx:4-30` | Exactly the principle the rest of the app should follow (F-13). |
| **CapabilityNotice** — an empty view explains the missing setting and links to it | `components/ui/CapabilityNotice.tsx` | Reuse this pattern for the first-run and "check can't run" states (F-19, F-20). |
| **Connect by pasting a link**; the form is read automatically; languages offered by name | `CreateSurveyPage.tsx:53-57, 318-325`, `utils/koboUrl.ts` | Removes the XLSForm export/upload step entirely. |
| **Collection-targets control** — four modes as a ladder, "Divide evenly" / "Apply to every group", discard warning before switching mode | `components/ui/CollectionTargets.tsx` | Best-designed control in the app; use it as the template for W4. |
| **Form check (linter)** — severity-grouped, one-line headlines with details on request, "Add as quality check" | `components/linter/FormLintPanel.tsx` | Turns expertise into one click; results survive tab switches. |
| **Suggestions that are visible, not silently applied** — "Suggested" optgroups for identifiers and don't-know codes | `VariableDropdown.tsx`, `DkStringValues.tsx` | Extend to the hidden date/time identifiers (F-20). |
| **Outlier and AI finding cards** — expected range, distance bar, sample-size warning; AI issues grouped by question with the answer quoted | `SubmissionDetail.tsx:953-1244` | The evidence reviewers need; just move it up (F-02). |
| **Status changes write back to Kobo** and update Field Compass immediately | `routers/submissions.py:407-520` | Kobo stays the source of truth; no double entry. |
| **Readable backend errors** — JSON-safe error parsing, generic 500 bodies | `AuthContext.tsx:40-73`, `main.py` exception handler | Good base for W5's plain-language banners. |
| **Typed-name confirmation** for deleting a survey | `SurveySettingsPage.tsx:1053-1098` | Proportionate protection for an irreversible action. |
| **Code comments that record the UX reasoning** | throughout | Rare and valuable; this review leaned on them to avoid contradicting decisions. |
| **Dark mode** covers nearly everything with passing contrast | all | Only one measured failure. |
| **Fast pipeline** — 147 submissions fetched, audited and checked in 2–3.5 s | ETL | Pull-on-demand is viable; a scheduler (F-14 B) is an enhancement, not a rescue. |

---

## 9. Roadmap

### 9.1 Sequence

| Step | When | Contents | Why this order |
|---|---|---|---|
| **0 — Data-loss bug** | Immediately | Backend: `generate_llm_input_hash` list/str crash (F-13 B, details in §10), stop `kobo_fetcher` swallowing upstream errors, count `hfc_flagged` only for committed rows | Flags are being silently discarded today for any survey with AI checks + more than one don't-know code. |
| **1 — Honesty quick wins** | Week 1 (each ≤ 1 day) | F-13 A, F-18 B, F-08 A, F-09 A, F-15 A, F-21 A, F-16, F-35 A, F-28, F-29, F-31, F-24 A | Stop the UI saying untrue things; unblock non-default Kobo servers. Mostly copy, CSS and small state fixes. |
| **2 — Review loop v1** | Weeks 2–3 | F-01 A, F-02 B, F-03 A+B, F-12 A (label dictionary), F-27 A (`Field` component), F-19 A | The core job. F-12 feeds F-01/F-02 labels; `Field` is the first shared component. |
| **3 — Foundations** | Next cycle | F-33 (tokens + components, incrementally), F-32 (router), F-14 A (persisted last pull + `PullStatus`) | Unlock F-05 B, deep links, consistent banners. |
| **4 — Strategic bets** | Next cycle | F-01 B → F-09 B (issue filter + drill-down), F-08 B (W2), F-22 (W4), F-19 B + F-23 A (W3), F-36 (server pagination), F-26, F-30, F-34, F-10, F-11, F-20, F-04, F-05 A, F-24 B | Larger changes; several need validation first (below). |
| **5 — Later** | Backlog | F-06, F-07, F-17, F-25 | Low frequency or low severity. |

### 9.2 Adversarial review of the top 10

| # | Recommendation | Strongest argument against | Verdict |
|---|---|---|---|
| 1 | F-13: never show a failed pull as success | `kobo_fetcher` breaks on error deliberately so a partial pagination failure still yields the pages fetched; raising would throw away good data. | **Revised:** keep partial data, but return `upstream_error` and render amber "Pulled 800 of 1 000 before Kobo stopped responding". |
| 2 | F-18: save server with token + server picker | Few users are off the default server; a picker is one more thing to maintain. | **Kept.** The product targets humanitarian organisations, many of which use the EU and humanitarian servers; today those users are fully blocked. The picker keeps an "Other" field. |
| 3 | F-08: redefine Field Team metrics, drop "Top performer" | "Validated = approved by supervisor" may be the team's HFC vocabulary; managers may like the leaderboard as motivation; removing it disrupts existing users. | **Revised:** step A only fixes words, colours and the podium (no metric removed); B (flag-rate ranking) is **validate-first** (Q4, Q5). The site's own promise is "flag rates… per enumerator", so B aligns with stated intent. |
| 4 | F-01: default the queue to "Needs review" | QA practice also spot-checks a sample of *clean* submissions; defaulting to flagged-only could erode back-checks. | **Revised:** "All" stays one click away; the default is Needs review only when it is non-empty; spot-check sampling noted as Q12. |
| 5 | F-02: "Why flagged" block above the decision | Duplicates the check cards below; adds height. | **Kept**, with passed checks collapsed (option A) so the page gets *shorter* overall. |
| 6 | F-03: auto-advance + A/N/H shortcuts | Auto-advance causes mis-clicks on the wrong item; single-key shortcuts violate WCAG 2.1.4 and collide with screen readers. | **Revised:** auto-advance is a per-user toggle with Undo; shortcuts are scoped to the queue/detail and can be switched off (2.1.4 compliant). Default-on is **validate-first**. |
| 7 | F-21 + F-15: section-scoped save with inline confirmation | Merging one section into the last-saved config could overwrite a concurrent edit by another owner. | **Kept:** the current code already overwrites the *whole* config; scoping reduces, not increases, that risk. Dropping Edit buttons (F-22) moved to **Next** and validate-first. |
| 8 | F-09: remove the false hint now, wire the drill-down later | Removing the hint "takes away a feature". | **Kept:** the feature does not exist; the hint makes users believe they are looking at a filtered list. |
| 9 | F-35: handle expiry everywhere | A hard logout on 401 (what `authFetch` already does) is simplest. | **Revised:** hard logout would discard an unsaved reviewer note or half-edited settings; use a sign-in dialog that preserves state. |
| 10 | F-19: first-run path | Few new sign-ups during beta; a checklist is design effort for a rare moment. | **Revised:** do the cheap copy/link/draft-persistence fixes (A) now; the checklist (B) waits for more onboarding. Respects the documented "nothing auto-selected" rule. |

No top-10 recommendation contradicts a documented decision: optional dates (`CreateSurveyPage.tsx:283-287`), optional targets and enumerator, "no auto-selection" and "suggest only when unambiguous" are all preserved. One potential conflict was resolved above (F-03 shortcuts vs WCAG 2.1.4).

### 9.3 All findings — recommended option, bucket, dependencies

| ID | Finding (short) | Sev | Priority | Bucket | Recommended | Effort | Depends on |
|---|---|---|---|---|---|---|---|
| F-13 | Failed/partial pulls shown as success | 4 | Now | Quick win (+ backend bug) | A + B | S–M | — |
| F-18 | Kobo server URL cannot be saved | 4 | Now | Quick win | B | S | — |
| F-08 | Field Team ranks review progress as quality | 4 | Now → Next | Quick win → Validate-first | A then B | S → M | B: Q4, Q5 |
| F-01 | No way to isolate flagged submissions | 3 | Now | Strategic (cheap v1) | A then B | S → M | B needs F-12 |
| F-02 | Flag reason below the fold | 3 | Now | Strategic | B | S–M | F-12 labels |
| F-03 | No auto-advance; stale filtered list | 3 | Now | Validate-first | A + B | S | F-01 |
| F-09 | Issue bars promise a filter they don't apply | 3 | Now | Quick win → Strategic | A then B | S | B needs F-01 B |
| F-15 | Save confirmations wiped; errors auto-hide | 3 | Now | Quick win | A | S | — |
| F-19 | No first-run path; draft lost | 3 | Now | Quick win → Strategic | A then B | S → M | B needs F-23 |
| F-21 | One section's save commits others' edits | 3 | Now | Quick win | A | S | — |
| F-27 | Labels not bound to fields | 3 | Now | Foundation | A | S–M | — |
| F-28 | Invisible focus on queue rows | 3 | Now | Quick win | A (global focus-visible rule) | XS | — |
| F-35 | Expired session not detected | 3 | Now | Quick win | A | S | — |
| F-29 | Contrast failures (8 pairs) | 2 | Now | Quick win | A, then B with F-33 | XS–S | — |
| F-05 | No detail pane < 768 px / 200 % zoom | 3 | Next | Strategic | A then B | M | B needs F-32 |
| F-10 | Counts disagree across screens | 3 | Next | Strategic | A + B | S–M | F-12 |
| F-14 | No data-freshness indicator | 3 | Next | Foundation | A | S–M | — |
| F-20 | Date/start/end identifiers invisible | 3 | Next | Quick win | B | S | Validate prevalence |
| F-23 | New surveys start with checks off | 3 | Next | Validate-first | A (+B) | S–M | Q6 |
| F-26 | Keyboard: 147 Tabs to decide; mouse-only charts | 3 | Next | Strategic | A + B | S–M | F-03 |
| F-32 | No URLs | 3 | Next | Foundation | A | M | — |
| F-36 | Queue downloads everything twice | 3 | Next | Strategic | A | M | Q10 |
| F-04 | Rows lack who / where / what | 2 | Next | Quick win | A | S | F-12 |
| F-11 | Enumerator codes; phantom "Unknown" | 2 | Next | Quick win | A | S | — |
| F-12 | Jargon and check IDs | 2 | Next | Foundation | A | S | — |
| F-16 | Failed pull replaces the list | 2 | Next | Quick win | A | XS | — |
| F-22 | Four save models on one page | 2 | Next | Validate-first | A | M | F-21 |
| F-24 | AI "Add to editor" saves live; no undo on delete | 2 | Next | Quick win | B + A | XS–S | — |
| F-30 | Dialogs/dropdowns lack semantics | 2 | Next | Foundation | A | S–M | F-33 |
| F-31 | Title, live regions, autocomplete | 2 | Next | Quick win | A, then B with F-32/F-33 | XS | — |
| F-33 | No tokens / shared components | 2 | Next | Foundation | A | M | — |
| F-34 | Viewers see actions they cannot perform | 2 | Next | Quick win | A | S | — |
| F-06 | Edit history not viewable | 2 | Later | — | B | S–M | — |
| F-07 | Kobo call per click; silent failure | 2 | Later | — | A | S | — |
| F-17 | AI check can hang forever | 2 | Later | — | B (A without Celery beat) | S–M | — |
| F-25 | "Kobo Asset ID" contradicts link decision | 1 | Later | — | A | S | — |

Notes: F-12, F-16, F-24 and F-31 are marked Next in `findings.json` but are cheap enough to ride along with step 1 or 2 of the sequence. F-29 is severity 2 but scheduled Now because it costs minutes and removes the worst legibility problem on the core list.

---

## 10. Open questions for the owner

| # | Question | What it changes |
|---|---|---|
| Q1 | The brief referenced J1–J9 and a `leads_to_verify` list that were not attached. Do they match §4 and the lead table in §2? | Any journey or lead not covered here can be walked with the same scripts (`fixtures/`). |
| Q2 | Do reviewers work on laptops only, or also on tablets/phones in the field? | Raises F-05 from Next to Now if tablets are common. |
| Q3 | Which Kobo servers do current and pilot organisations use? | The server list in F-18 B / W3-B. |
| Q4 | Is "Approved" (Kobo validation status) meant to be the same as "validated" in your methodology, and should Field Team show reviewer throughput at all? | F-08 wording and whether "Reviewed" stays on the page. |
| Q5 | Which enumerator signals do coordinators act on (duration, DK rate, flag rate, specific checks)? | The columns and sort of W2 (F-08 B). |
| Q6 | Is there an organisational default set of checks (e.g. minimum duration, weekend days) for new surveys? | F-23 recommended set. |
| Q7 | Should "On Hold" count as reviewed? | The Needs-review definition (F-01, F-10). |
| Q8 | Should AI findings put a submission into Needs review (i.e. recompute `qa_status`)? | F-10 B; today 3 AI-only submissions are invisible to FLAGGED counts. |
| Q9 | Is the scheduled pull (Airflow in the README) still planned, and when? | F-14 A vs B. |
| Q10 | Typical and largest survey sizes (submissions)? | Urgency of F-36. |
| Q11 | Was the leaderboard / "Top performer" framing requested by partners? | How far F-08 A may go without consultation. |
| Q12 | Do reviewers routinely spot-check a sample of clean submissions? | Adds a "Spot-check sample" tab to W1. |

### Separate defect to file (outside UI scope)
**ETL crash when AI qualitative checks are on and don't-know codes are stored as a list.** `backend/utils/rule_versioning.py:93` calls `.lower()` on `dk_string_value`, which the create/settings screens now save as a list (e.g. `["dk", "dont_know"]`). Every submission with a monitored text value raises `AttributeError`, is rolled back at `backend/etl/pipeline.py:346`, and loses its deterministic flags; `hfc_flagged` (line 282) was already incremented, so the UI still reports flags. Reproduced locally: `errors: 146` of 147, 5 flags persisted instead of ~60. Fix: accept `str | list[str]` in `generate_llm_input_hash` and every other `dk_string_value` consumer, isolate the LLM-queueing step from deterministic results, add a regression test. (I tried to queue this as a separate task from this session; the task tool timed out twice, so it is recorded here instead.)

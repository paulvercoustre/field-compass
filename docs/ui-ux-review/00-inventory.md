# 00 — Screen, component and state inventory

Source of truth: `frontend/` at commit `2e4d096` (main, 2026-09-29). Line references are to that commit.

## 1. Application shell

| Element | File | Notes |
|---|---|---|
| Router | none. `App.tsx:15` defines `type View` (7 values) held in `useState`, persisted to `localStorage.currentView` (`App.tsx:73-87`). No URLs, no back button, no deep links. Cross-page navigation uses `window` CustomEvents `navigateToSettings` / `navigateToDashboard` (`App.tsx:95-110`). |
| Survey gate | `App.tsx:24-55` `RequiresSurvey` wraps 5 survey-scoped views. Empty-state copy is fixed: "Please select a survey from the sidebar to view its settings." on every view (`App.tsx:50`). |
| Sidebar | `components/Sidebar.tsx` — app title, collapse toggle (w-64 ↔ w-14), "New survey", survey list (name + Kobo asset ID + Editor/Viewer badge), user menu popover (Account Settings, Logout). Collapsed sidebar hides the survey list entirely. |
| Top bar | `App.tsx:198-219` — selected survey name (truncated `max-w-[200px]`), 5 nav buttons: Submissions · Data Quality · Data Collection Progress · Field Team · Survey Settings. Nav is not a `<nav aria-label>`-labelled landmark with `aria-current`. |
| Auth | `contexts/AuthContext.tsx` — JWT in `localStorage.field_compass_token`; only `authFetch` (user endpoints) handles 401 → logout. Data services (`services/api.ts`, `progressApi.ts`, `qualityApi.ts`, `lintApi.ts`, `aiApi.ts`) do not. |
| Survey selection | `contexts/SurveyContext.tsx` — never auto-selects (documented decision, `SurveyContext.tsx:48-55`); restores the tab's last choice from `sessionStorage` (`utils/selectedSurveyStorage.ts`). Login and "New survey" clear it. |

## 2. Screens

| # | View key / screen | Entry points | File (lines) | Primary job | Key states handled in code |
|---|---|---|---|---|---|
| S0 | Login / Register | unauthenticated; `#register` hash opens Register tab | `pages/LoginPage.tsx` (222) | Sign in, create account | submitting, error banner; client checks: pw match, ≥8 chars |
| S1 | `dashboard` → **Submissions** (review queue) | top nav; default view; Data Quality status cards; Field Team rows/bars/dots | `components/Dashboard.tsx` (341) + `SubmissionFilters` (428) + `SubmissionList`/`Item` + `SubmissionDetail` (1261) + `SubmissionDataViewer` (291) + `ValidationStatusDropdown` (142) | Triage & validate submissions | loading spinner; fetch error; "No submissions match your filters."; empty detail ("Select a submission…"); ETL running/success/error banners; LLM-pending auto-poll every 8 s (`Dashboard.tsx:156-169`); ↑/↓ keyboard nav (`Dashboard.tsx:224-255`); detail pane `hidden md:block` (<768 px: no detail) |
| S2 | `qualityOverview` → **Data Quality** | top nav | `pages/QualityOverviewPage.tsx` + `components/quality-dashboard/*` (5 files) | Survey-level quality picture | loading, error ("Try again" runs a full ETL), date preset; status cards clickable → Submissions filtered by status; issue bars "click to filter" (not implemented, `QualityOverviewPage.tsx:35-41`) |
| S3 | `dataCollectionProgress` → **Data Collection Progress** | top nav | `pages/DataCollectionProgressPage.tsx` + `progress-tracker/ProgressDataView.tsx` | Progress vs targets | loading, error; "Approved surveys only" switch; no-targets explanatory copy; sub-tabs Overall / By {column} / Detailed (text filter) |
| S4 | `enumeratorPerformance` → **Field Team** | top nav | `pages/EnumeratorPerformancePage.tsx` + `EnumeratorSummaryCards`, `SubmissionsBarChart`, `EnumeratorLeaderboard`, `QualityScatterPlot`, `PerformanceDataView` | Compare enumerators, drill into one | loading, error, `CapabilityNotice` when enumerator not configured; click row/bar/dot → Submissions filtered by enumerator |
| S5 | `settings` → **Survey Settings** | top nav; CapabilityNotice button; post-create modal | `pages/SurveySettingsPage.tsx` (2521) | Configure survey, access, checks | 3 left-nav tabs: General · Access · Data Quality Checks. Per-section save models (see §4). Delete-survey modal (type name to confirm). View-only badge for viewers. |
| S5a | Settings › General | | `SurveySettingsPage.tsx:1150-1644` | Profile, Kobo tool, targets, core identifiers, delete | |
| S5b | Settings › Access | | `SurveySettingsPage.tsx:1645-1771` | Share / change / revoke access | `confirm()` on revoke; owner-only share form |
| S5c | Settings › Data Quality Checks | | `SurveySettingsPage.tsx:1138-1149, 1772-2512` | Form check (linter), general checks, outliers, AI qualitative, custom rules (manual + AI) | Form check results persist across tabs (hidden, not unmounted) |
| S6 | `createSurvey` → **Create New Survey** | sidebar "New survey" (clears selection) | `pages/CreateSurveyPage.tsx` (854) | Connect a Kobo project | link → auto-read form after 500 ms; form check auto-runs; targets; identifiers; "Create Survey" enabled when name + valid link; post-create modal "Configure Now / Later" |
| S7 | `userSettings` → **User Settings** ("Account Settings" in menu) | sidebar user menu | `pages/UserSettingsPage.tsx` (555) | Profile, Kobo API URL + token, password, delete account | per-section banners; `confirm()` on token removal; delete-account modal (no typed confirmation) |

### Unreachable code (not examined as screens)

| File | Evidence |
|---|---|
| `pages/RuleBuilder.tsx`, `components/rule-builder/GlobalParameters.tsx` | not imported by `App.tsx`; `GlobalParameters` only imported by `RuleBuilder` |
| `pages/ProgressTracker.tsx` | not imported; hard-coded title "Monitoring Tracker: Livelihood Actors"; picks `surveys[0]` |
| `components/HistoryViewer.tsx`, `components/JsonViewer.tsx`, `components/SurveySelector.tsx` | no importers (grep) — so the "Edited" badge in Submission detail has no way to show *what* was edited |

## 3. Shared components

| Component | File | Used by | Notes |
|---|---|---|---|
| `Badge` (status pill) | `components/Badge.tsx` | list items | 11 status strings incl. legacy QA statuses |
| `Spinner` | `components/Spinner.tsx` | everywhere | fixed 32 px; used inside buttons too (32 px spinner in a 36 px button) |
| `ErrorMessage` | `components/ui/ErrorMessage.tsx` | settings, create, rule editor | **auto-hides after 5 s by default** (`autoHide = true`, line 17) |
| `SuccessMessage` | `components/ui/SuccessMessage.tsx` | settings, create, AI | auto-hides after 5 s |
| `InfoTip` | `components/ui/InfoTip.tsx` | form labels | 16×16 px button, Esc closes, `role=tooltip` |
| `CapabilityNotice` | `components/ui/CapabilityNotice.tsx` | Field Team | good pattern: explains why a view is empty + action |
| `CollectionTargets` | `components/ui/CollectionTargets.tsx` | create, settings | fieldset/legend, 4 modes, discard warning |
| `VariableDropdown` | `components/ui/VariableDropdown.tsx` | create, settings | "Suggested" optgroup; label not bound to select |
| `DkStringValues` | `components/ui/DkStringValues.tsx` | create, settings | chips + suggestions |
| `FormField` | `components/ui/FormField.tsx` | RuleEditor only | the only component that binds `<label htmlFor>` + `aria-invalid`/`aria-describedby` |
| `SubTabButton` | `components/ui/SubTabButton.tsx` | progress, field team | buttons without `role=tab`/`aria-selected` |
| `InfoModal` | `progress-tracker/InfoModal.tsx` | Field Team definitions | no focus trap, no Esc, no `role=dialog` |
| `QualityCheckPromptModal` | `components/QualityCheckPromptModal.tsx` | create | no `role=dialog`, no focus management |
| `MultiSelectDropdown` | inside `SubmissionFilters.tsx:32` | filters | custom listbox, mouse-only close, no keyboard model |
| `FormLintPanel` | `components/linter/FormLintPanel.tsx` | create, settings | severity-grouped findings, "Add as quality check" |
| Rule builder set | `components/rule-builder/*` | settings (Custom checks) | RuleEditor, ConditionRow, StagedRulesList, AINaturalLanguageInput, AISuggestedRules |

## 4. Save/edit models on Survey Settings (state inventory)

| Section | Model | Save button | Error/success location |
|---|---|---|---|
| Survey Profile | always-editable; Save/Cancel appear when dirty | "Save Changes" | page top (`:1042-1050`) |
| Kobo Tool | read-only until **Edit** | "Save Changes" / "Cancel" | page top |
| Data collection targets | read-only until **Edit** | "Save Changes" / "Cancel" | page top |
| Core Identifiers | always-editable; Save/Cancel when dirty | "Save Changes" | page top |
| General Quality Checks | always-editable; Save/Cancel when dirty | "Save Changes" | page top |
| Outlier Checks | read-only until **Edit** | "Save Changes" / "Cancel" | page top |
| Qualitative Checks | read-only until **Edit** | "Save Changes" / "Cancel" | page top |
| Custom Quality Checks | **Edit** / **Done**; each rule saves immediately; delete immediately | "Add Rule to List" (saves to server) | page top |
| Access | immediate on change; `confirm()` on revoke | "Share" | page top |

All section saves call one `persistSurveyConfig()` (`:648-681`) that writes **every** section's current in-memory state, so saving one section also persists unsaved edits made in another.

## 5. Data/status vocabularies shown to users

| Concept | Where | Values shown |
|---|---|---|
| Kobo validation status | list badge, detail dropdown, Data Quality cards, filters | Approved · Not Approved · On Hold · Not Reviewed |
| Computed QA status (`qa_status`) | not shown directly; drives "Validated/Needs Review" on Field Team | PENDING_APPROVAL · FLAGGED · APPROVED · REJECTED |
| "Validated" (Field Team) | definition text `PerformanceDataView.tsx:13`; computation `backend/routers/progress.py:580` | Definition says "surveys with no issues found", but it is **computed as `qa_status == APPROVED`**, i.e. approved by a reviewer in Kobo (see F-08) |
| "Team Validated … approval rate" | `EnumeratorSummaryCards.tsx:70-74` | Approved / total (36/147 = 24.5 % in the review data), same number as Data Quality's "Approved" |
| Check IDs | Data Quality charts | raw ids e.g. `duration_too_short`, `outlier_hh_size`, `qual_content_quality` |

## 6. Breakpoints and theming

- Tailwind 3, `darkMode: 'media'` (`tailwind.config.js:13`); one custom token `gray-850`. No theme toggle.
- Layout assumes ≥ 768 px for the review loop (`Dashboard.tsx:330` `hidden md:block`). Sidebar is always rendered (w-64/w-14) at every width.

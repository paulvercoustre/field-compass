# Code quality and simplicity review

Scope: `backend/` (FastAPI, SQLAlchemy, Celery) and `frontend/` + root Vite entry. Lens: how easy the code is to read and change. Security, performance and formatting nits are out of scope except where they make the code harder to follow. Reviewed on commit `47b7cf5`, 2026-10-05.

## 1. Summary

The backend is in good health. CI is green (ruff clean, 806 tests pass, 86% coverage). Comments record *why* decisions were made, and modules such as `services/runs.py` and `services/survey_config.py` open with docstrings worth copying elsewhere. The debt is concentrated in three places:

- **Route handlers that carry domain logic.** Four of the seven F-ranked functions are route handlers, and the two worst are the least tested.
- **A handful of helpers copied across files.** The Kobo field lookup alone exists in eight copies.
- **Two very large frontend pages.**

The frontend has no tooling, and `tsc` is weaker than it looks: **`@types/react` is not installed, so every component, prop and hook is `any`.**

Best return on effort:

1. Add `@types/react`/`@types/react-dom`, fix the 11 errors this exposes, turn on `strict` (14 more), and add a frontend CI job.
2. Replace the 8 field-lookup copies and the 18 survey-id parse blocks with one helper and one FastAPI dependency.
3. Move `progress`, `quality` and `submissions` computation out of the routers into pure service functions, after adding tests around them.

**Do first:** item 1. It is about an hour of work and it turns every later frontend refactor from blind into type-checked.

## 2. Tooling baseline

All commands ran without committing any config. Python tools ran in a scratch venv; frontend tools used scratch configs.

**One caveat about the frontend measurements.** `npm ci` fails in this environment: the egress policy blocks `cdn.sheetjs.com`, where `package.json` pins `xlsx`. To take the measurements I installed the other deps plus `xlsx@0.18.5` from npm as a stand-in, and did not commit anything. The `xlsx` chunk size below is therefore approximate. CI will hit the same failure if its network is restricted.

### Backend

| Tool | Command (from `backend/`) | Count | Interpretation |
|---|---|---|---|
| Existing gate | `ruff check . && ruff format --check . && pytest -q` (ruff 0.1.15) | 0 / 0 / **806 passed, 3 skipped** | Green. |
| ruff 0.16.10, current config | `ruff check .` | 3 | UP042, C420, I001. The 0.1.15 pin hides these; they are trivial. |
| ruff, broad | `ruff check . --select E,W,F,I,B,C4,UP,SIM,RET,ARG,PTH,PERF,PL,RUF,TRY,ERA,C90 --statistics` | 1273 (1076 outside tests/scripts) | Mostly noise: PLR2004 264, PLC0415 187, B008 146 (FastAPI `Depends`). Signal: **B904 42**, **C901 35**, PLR0912/0913/0915 21/20/18. |
| ruff, ALL | `ruff check . --isolated --select ALL --statistics` | 10418 | Exploration only. Worth noting: **FAST002 168** (non-`Annotated` deps), **DTZ003 129** (`utcnow`), **BLE001 49** (blind `except`). |
| complexity | `--select C901`, `--select PLR0912,PLR0913,PLR0915` | 35 / 59 | Same hot spots as radon, below. `get_submissions` takes 11 arguments. |
| pyright 1.1.414 basic | `pyright -p <scratch config> .` | **1230 errors** (1006 app, 224 tests) | **916 (75%) come from legacy `Column()` ORM declarations** (see F10). After that come pydantic `Field(None, ...)` positional defaults that pyright reads as required, then genuine Optional-access issues. **42 of 85 app modules are already clean**, including all of `linter/`, `forms/`, `etl/dk_utils.py`, `etl/relevance.py` and `services/survey_config.py`. |
| vulture | `vulture . --min-confidence 80` | 5 | All intentional: `test_setup.py`'s import-as-assertion and SQLAlchemy listener signatures. At 60% there are 176 hits, mostly routes and registered checks; the ones verified by grep are in F9. |
| deptry | `deptry . --requirements-files requirements.txt` | 14 | Real: **`pandas`, `jsondiff`, `pydantic-settings` are never imported.** The rest are runtime drivers or test tools (psycopg2, bcrypt, email-validator, pytest…). |
| layering | grep over imports | 2 notes | No module below `routers/` imports from `routers/`. Two notes: `etl/pipeline.py:19-22` imports Celery queuers from `services/` (domain depends on workers), and `routers/surveys.py:16` imports from another router. |
| radon | `radon cc -s -a . --min C`; `radon mi -s .` | 22 D–F functions; MI C: `etl/hfc_engine.py` (0.0) | F: `HFCEngine._run_basic_checks` 46, `routers/quality.get_quality_overview` 46, `routers/admin.get_usage` 46, `routers/submissions.get_submissions` 45, `services/transcription_runtime.run_transcription_job` 44, `routers/progress.get_progress_data` 41. |
| coverage | `pytest --cov=.` | 86% total | Lowest: `routers/quality.py` **14%**, `etl/kobo_fetcher.py` 29%, `routers/ai.py` 35%, `routers/validation_rules.py` 36%, `services/ai_service.py` 38%, `routers/submissions.py` **39%**. |

### Frontend

| Tool | Command | Count | Interpretation |
|---|---|---|---|
| tsc as-is | `npx tsc --noEmit` | **10 errors** (fails today; nobody runs it) | Misleadingly low: React has no types, so JSX and props are `any`. |
| tsc with React types | same, with `@types/react@19` linked in | 11 | These are real; see F1. |
| tsc strict (scratch `tsconfig.strict.json`) | `npx tsc -p tsconfig.strict.json --noEmit` | 5316 without React types / **103 with** | With types: `strict` +14, `noUnused*` +26, `noUncheckedIndexedAccess` about +52, `noFallthroughCasesInSwitch` 0. Most errors: `ActivityIndicator.tsx` 23, `SubmissionDetail.tsx` 12, `CreateSurveyPage.tsx` 8. |
| ESLint (strictTypeChecked + stylistic + react-hooks + react-refresh + jsx-a11y) | `eslint -c <scratch> frontend index.tsx` | 1584 | Top rules: no-confusing-void-expression 268, prefer-nullish-coalescing 192, no-unsafe-* about 330, **no-explicit-any 78**, **no-misused-promises 72**, **no-floating-promises 47**, **react-hooks/set-state-in-effect 38**, **static-components 12**, **exhaustive-deps 10**, no-unnecessary-condition 127. |
| ESLint, minimal "adopt now" set | recommendedTypeChecked + rules-of-hooks + exhaustive-deps, `no-unsafe-*` off | 224 | Of these, no-misused-promises 72 (mostly async `onClick`) and no-floating-promises 47. |
| knip | `npx knip --config <scratch>` | 9 unused files, 27 unused exports, 10 unused types | Files are real (F9). `@fontsource-variable/inter` is a false positive (imported from CSS). |
| madge | `npx madge --circular --extensions ts,tsx frontend index.tsx` | 0 cycles | Good. |
| prettier | `npx prettier --check ...` | 124/124 files differ | Defaults: +12.5k/−6.9k lines. With `singleQuote, printWidth: 120`: 110 files, +5.6k/−4.5k. A formatter means one large mechanical commit; it is the owner's call. |
| build | `npm run build` | **one 1,513 kB chunk** (441 kB gzip) | No code splitting at all. Measured split: app 441 kB, recharts 389 kB, xlsx about 333 kB, react 224 kB. `xlsx` is used only in two upload parsers (`services/koboParser.ts:5`, `utils/samplingFrameParser.ts:4`), so it is a natural `import()`. |

### Recommendation: what to adopt, in order

1. **Frontend types and CI job (now).** Add `@types/react` and `@types/react-dom` to devDependencies. Fix the 11 errors, enable `"strict": true` in `tsconfig.json` (14 more), and add a CI job:
   ```yaml
   frontend:
     name: Frontend typecheck & build
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: '22', cache: 'npm' }
       - run: npm ci
       - run: npx tsc --noEmit
       - run: npm run build
   ```
   `noUnusedLocals`/`noUnusedParameters` come next, after F9 removes dead files. `noUncheckedIndexedAccess` comes last, via a separate `tsconfig.strict.json` that lists files as they become clean.

2. **Upgrade ruff (now).** Change the pin in `requirements.txt` and CI from `0.1.15` to a current `0.16.x`, then fix the 3 new hits in the same PR. Widen gradually:
   ```toml
   [lint]
   select = ["E","W","F","I","B","C4","UP","SIM","RET","PERF","RUF","PLE","PLW","C90"]
   ignore = ["E501","B008","B904"]   # B904 stays deferred, as documented
   [lint.mccabe]
   max-complexity = 25               # 5 functions over; noqa them, then lower the ceiling as they are split
   ```
   Adding SIM/RET/PERF/RUF/PLE/PLW today costs **77 hits, 24 auto-fixable**. RUF012's 18 hits are in test classes, so add a `tests/**` ignore for it.

   Later: `BLE001` + `S110` (after F11), `FAST002` (168 hits; mechanical migration to `Annotated[...]`, which also removes the need to ignore B008), `B904` when the deferred work happens (24 of its 42 hits disappear with F3), `DTZ` once `utcnow()` is replaced.

   Not recommended: `PLR2004`, `PLC0415` (several imports are deliberately local to break Celery import cycles), `PTH`, `TRY`, `ERA`. They are churn without clarity.

3. **pyright basic as a ratchet (after F10, or now on clean modules).** pyright has no built-in baseline, so start with an include list of modules that already pass and grow it:
   ```json
   { "typeCheckingMode": "basic", "pythonVersion": "3.11",
     "include": ["forms", "linter", "utils", "etl/dk_utils.py", "etl/relevance.py",
                 "services/survey_config.py", "services/ai_client.py", "models.py"] }
   ```
   Converting the ORM models to `Mapped[...]` (F10) clears 75% of the remaining errors at once. If you want a real per-file baseline instead, `basedpyright --writebaseline` provides one.

4. **ESLint (soon, warn first).** typescript-eslint `recommendedTypeChecked` plus `react-hooks` (`rules-of-hooks: error`, `exhaustive-deps: warn`), and `no-floating-promises: error`. Set `no-misused-promises` with `checksVoidReturn: { attributes: false }` so async `onClick` handlers stay legal. Leave `no-unsafe-*` and `no-explicit-any` off until strict tsc is in. `strictTypeChecked` and jsx-a11y are later steps.

5. **knip in CI (soon).** Run it after F9, with `entry: ["index.tsx"]`, `project: ["frontend/**/*.{ts,tsx}"]`, and `ignoreDependencies: ["@fontsource-variable/inter"]`.

6. **Prettier (owner's decision).** If adopted: `singleQuote: true, printWidth: 120`, in one standalone commit, listed in `.git-blame-ignore-revs`.

## 3. Findings

Ranked by impact over effort.

### F1. React has no types, so the frontend typecheck checks almost nothing

- **Severity:** structural
- **Evidence:** `package.json:19-27` (devDependencies) has no `@types/react`/`@types/react-dom`, and React 19 ships no types of its own. `tsc` reports 180 TS7016 "could not find a declaration file for module 'react'", which non-strict mode silently treats as `any`. Every `React.FC<Props>`, `useState<T>` and JSX attribute is unchecked. With the types installed, the as-is errors include real defects:
  - `components/SubmissionFilters.tsx:239` reads `activeFilters.samplingVariable`, which is not on `FilterState` (`types.ts:210`). `filterOptions.samplingValues` is therefore always `[]`, and it is never read either.
  - `utils/filterUtils.ts:100` and `components/SubmissionFilters.tsx:393` compare a `QAStatus` against `'triage'`, which is not a status.
  - `utils/koboLabelUtils.ts:1` imports `SurveyConfig` from `../types`, which does not export it.
  - `pages/ProgressTracker.tsx:90` and `pages/RuleBuilder.tsx:142` have type errors, but both pages are unreachable (F9).
  - `pages/SurveySettingsPage.tsx:1096` and `pages/UserSettingsPage.tsx:154`: `navItems` is typed so the generic `SettingsLayout<T>` infers `T = string`.
- **Why it matters:** the two biggest refactors in this report (F7, F8) are frontend refactors with no tests. Without types, a renamed prop or a wrong callback signature fails only at runtime.
- **Proposed change:** add the two dev dependencies, fix the 11 errors (delete the dead branch at `SubmissionFilters.tsx:239`, drop `'triage'`, type `navItems` as `SettingsNavItem<SurveySettingsTab>[]`), turn on `strict`, and add the CI job from §2.
- **Effort:** S. Safe without new tests, because it is types only plus removal of dead branches.

### F2. The Kobo "find answer by path suffix" rule exists in eight copies with different edge cases

- **Severity:** notable
- **Evidence:**
  - Backend: `routers/progress.py:69`, `routers/quality.py:31`, `routers/submissions.py:85`, `etl/hfc_engine.py:405`, `utils/rule_versioning.py:63`.
  - Frontend: `components/SubmissionDetail.tsx:28` **and** `:301` (twice in one file), `utils/filterUtils.ts:16`.
  - The copies disagree. `quality.py` guards against `submission_data is None`; `progress.py` and `submissions.py` do not. `hfc_engine.py` guards against a `None` field name and returns the matched path. `rule_versioning.py:66` says it "mirrors the logic in HFCEngine._get_field_value" but skips the `None` guard.
- **Why it matters:** this is the rule that decides which answer a check, a filter and a progress count read. A fix to one copy (the `None` guard was clearly added after a bug) does not reach the others, and the comments already admit they must be kept in sync by hand.
- **Proposed change:** add `forms/answers.py` (`forms/` is stdlib-only and already the home of form semantics) with `find_answer(data: Mapping | None, name: str | None) -> tuple[Any, str | None]`. Keep the HFC engine's behaviour as the reference. Replace the five backend copies. In the frontend, keep the one in `utils/filterUtils.ts` (rename to `findAnswer`) and import it in `SubmissionDetail.tsx`.
- **Effort:** S. Add a table-driven unit test for `find_answer` first, covering exact key, group path, `None` data, `None` name and no match. The existing HFC and API tests then cover the call sites.

### F3. Survey-id parsing and access checks are repeated in every router

- **Severity:** notable
- **Evidence:**
  - The same `try: UUID(survey_id) except ValueError: raise HTTPException(400, "Invalid survey_id format…")` block appears **18 times** across 10 routers, for example `routers/progress.py:245` and `:474`, and six times in `routers/surveys.py`.
  - Two routers have already written a private helper for it, independently: `routers/transcription.py:69` `_uuid()` and `routers/lint.py:64` `_parse_survey_id()`.
  - `require_survey_access(...)` follows at 41 call sites.
  - 24 of the 42 deferred B904 hits are these blocks.
- **Why it matters:** each handler opens with 8 lines of boilerplate before the code that matters, and the error text and status code can drift per copy.
- **Proposed change:** add a dependency factory to `services/permissions.py`:
  ```python
  def survey_access(min_level: Literal["viewer", "editor", "owner"] = "viewer"):
      def dep(survey_id: str = Query(...), db=Depends(get_db),
              user=Depends(get_current_active_user)) -> SurveyConfig:
          return require_survey_access(db, user, parse_survey_id(survey_id), min_level)
      return dep
  ```
  Handlers then take `survey: SurveyConfig = Depends(survey_access("editor"))`. Keep the parse inside the dependency, raising `from None`, so the 400 status and message stay exactly as they are; FastAPI's built-in `UUID` validation would return 422 instead.
- **Effort:** S–M (mechanical, one router per commit). `tests/test_error_responses.py` and the API tests already cover 400/403/404.

### F4. Route handlers hold the domain logic, and the two worst are barely tested

- **Severity:** structural
- **Evidence:**
  - `routers/progress.py:221-443` (`get_progress_data`, CC 41) and `:447-667` (`get_performance_data`, CC 26) are pure aggregation over a list of submissions plus config. They include a nested `_count_dk_values` closure (`:529`), and target-column detection is written twice (`:173-179` inside `_calculate_targets_from_frame`, again at `:277-284`).
  - `routers/quality.py:115` (`get_quality_overview`, CC 46, **14% covered**) and `routers/submissions.py:147` (`get_submissions`, CC 45, 11 arguments, **39% covered**) each parse and apply the same enumerator and sampling filters, with different semantics:
    - `submissions.py:288-323` drops submissions whose value is falsy. `quality.py:91-109` compares `str(value)`, so a missing answer matches the literal filter `"None"`.
    - `submissions.py:283-286` reads `config["sampling_frame"]["sampling_cols"]` directly, bypassing `services/survey_config.get_sampling_cols()`, which strips blank columns. The `services/survey_config.py` docstring says this module exists to stop exactly that kind of direct read.
  - `routers/admin.py:65` (`get_usage`, CC 46) has the same shape.
- **Why it matters:** these handlers mix HTTP parsing, permission checks, querying and arithmetic. That is why they cannot be unit-tested and why the two filter implementations have drifted. Anyone changing a progress rule has to read 450 lines of a router.
- **Proposed change:**
  - Create `services/progress.py` with pure functions `compute_progress(submissions, config, approved_only) -> ProgressData` and `compute_performance(submissions, config) -> PerformanceData`. Hoist `find_target_column(headers)` and `count_dk_values(...)` to module level.
  - Create `services/submission_filters.py` with one `parse_sampling_filters(str) -> dict[str, list[str]]` and one `apply_answer_filters(subs, enumerator_field, enumerators, sampling_filters, sampling_cols)`, used by both `/submissions` and `/quality-overview`.
  - Routers keep: parse query, `Depends(survey_access())`, query, call service, return.
- **Effort:** M. Not safe without tests. **Before splitting, add characterization tests:** `/quality-overview` with enumerator and sampling filters (currently 14%), and `/submissions` with each filter including a submission missing the filtered field. They should pin today's behaviour, and the owner should decide which of the two filter semantics is intended. **Question for the owner:** should a submission with no answer for a sampling filter be excluded (submissions) or matched as `"None"` (quality)?

### F5. Survey config is an untyped dict, and its defaults live in several places

- **Severity:** notable
- **Evidence:**
  - `etl/hfc_engine.py:134-204`: `HFCEngine.__init__` reads about 30 keys with inline defaults, such as `weekend_days` `[5, 6]`, `office_hours_start` `"08:00"`, `outlier_threshold` 1.5 and `dk_percentage_threshold` 50.0.
  - `frontend/pages/SurveySettingsPage.tsx:52-72` repeats them as `DEFAULT_QUALITY_CHECKS`.
  - The dirty check `isGeneralFlagsDirty` (`SurveySettingsPage.tsx:265-279`) repeats them a third time by hand, field by field, instead of using `DEFAULT_QUALITY_CHECKS` and `GENERAL_FLAG_KEYS` (`:44`), which sit 200 lines above.
  - `services/survey_config.py` already covers core identifiers and sampling, and its docstring explains why ("four call sites used to reach into `sampling_frame` directly"). Quality checks and global parameters never got the same treatment. Raw `.get("quality_checks"|"global_parameters"|...)` reads remain in `etl/hfc_engine.py` (4), `routers/ai.py` (5), `utils/rule_versioning.py` (2) and three routers.
- **Why it matters:** a default changed on one side silently disagrees with the other. A typo in a key is a silent `None`. Pyright cannot help, because everything is `dict[str, Any]`.
- **Proposed change:**
  - Backend: finish what `survey_config.py` started. Add Pydantic models `QualityChecks`, `GlobalParameters` and `SurveySettings` (with `extra="allow"` so stored configs still load) and a `settings_of(config_data) -> SurveySettings` that parses once. `HFCEngine.__init__` keeps one line per attribute, read from typed fields.
  - Frontend: compute dirty as `GENERAL_FLAG_KEYS.some(k => !equal(qc[k], savedQc?.[k] ?? DEFAULT_QUALITY_CHECKS[k]))`.
  - Optionally expose defaults from the API so the frontend copy can go.
- **Effort:** M (backend), S (frontend dirty check). The backend change is covered by `test_hfc_engine.py` and `test_survey_config.py`. The frontend change needs F1 first.

### F6. Every frontend API module re-implements auth, error parsing and logging

- **Severity:** notable
- **Evidence:**
  - The token key `'field_compass_token'` is spelled out in 11 files. `services/apiBase.ts:21` has `TOKEN_KEY`, but `progressApi.ts:8` and others repeat the literal.
  - Six different header helpers: `progressApi.ts:12` `createAuthHeaders`, `aiApi.ts:15` `createAuthHeaders`, `lintApi.ts:10` `authHeaders`, `activityApi.ts:94` / `transcriptionApi.ts:148` / `aiConnectionsApi.ts:127` `headers`.
  - Almost every function in `progressApi.ts` (577 lines) is the same 18-line block: `try { apiFetch → if (!ok) parse detail → throw new Error } catch (e) { console.error; throw e }`, as at `:234-325`. That gives 15 `console.error` calls for errors that are rethrown and then shown by the caller anyway.
  - `activityApi.ts:103` already defines an `ApiError` that carries status and body. The other modules throw plain `Error` and lose the status.
- **Why it matters:** about 40% of the service layer is boilerplate. Error handling differs per module (some keep `detail`, some only `statusText`), so the same server error reads differently on different pages.
- **Proposed change:** in `apiBase.ts`, add `request<T>(path: string, init?: { method?, body?, auth? = true }): Promise<T>`. It sets the JSON and Authorization headers from `TOKEN_KEY`, goes through `apiFetch` (keeping the re-auth retry), throws `ApiError(status, detail, body)` (moved from `activityApi.ts`), and returns `undefined` for 204. Each endpoint then becomes one line, e.g. `export const getSurveyConfig = (id: string) => request<SurveyConfig>(\`/api/surveys/${id}\`)`. Migrate module by module and delete the local header helpers and logging.
- **Effort:** M. There are no frontend tests, so add Vitest with one test file for `request()` (success, 204, `detail` error, 401 retry) before migrating. After F1, the compiler checks the call sites.

### F7. Navigation runs on window events, localStorage flags and `setTimeout` races

- **Severity:** notable
- **Evidence:**
  - `App.tsx:120-149` listens for three global events: `navigateToSettings`, `navigateToDashboard` and `fc:navigate`.
  - `pages/CreateSurveyPage.tsx:413-460` and `:462-510` are two roughly 45-line near-copies (`handleConfigureNow` / `handleConfigureLater`). Each refreshes surveys, selects one, waits 50 ms, "double-checks" the selection and dispatches an event after 100 ms. The double-check at `:437` reads `selectedSurvey` from the render's closure, so it can never see the selection made 3 lines earlier. The workaround cannot work as written.
  - The "open the quality tab" request travels through `localStorage` (`CreateSurveyPage.tsx:418-419`, read and cleared at `SurveySettingsPage.tsx:290-298`), even though `App.tsx:97` already has a `requestedTab` mechanism for this purpose.
  - `contexts/ActivityContext.tsx:213-223` (`navigate`) already does the right sequence: select the survey, then switch view.
- **Why it matters:** three mechanisms for one job, and the timing code reads as if it fixes a race it does not fix. A new page wanting to link elsewhere has no obvious API to call.
- **Proposed change:**
  - Add a `NavigationContext` provided by `AppContent`, exposing `navigate(target: NavigationTarget)` with the existing type from `ActivityContext.tsx:21`. It selects the survey if `survey_id` is given, sets `requestedTab`, sets filters and sets the view.
  - `ActivityContext.navigate` delegates to it.
  - `CreateSurveyPage` keeps one handler: `await refreshSurveys(); navigate({ view: later ? 'dashboard' : 'settings', survey_id: id, tab: later ? undefined : 'quality' })`.
  - Delete the window events, the localStorage flags and every `setTimeout` in those handlers.
- **Effort:** S–M. No automated tests exist, so add a manual checklist to the PR: create survey → configure now / later, notification link, activity-panel link, Field team "open settings".

### F8. `SurveySettingsPage.tsx` is a 2,477-line component with 55 `useState` calls

- **Severity:** structural
- **Evidence:**
  - Seven sections each carry their own `isEditingX` / `isSavingX` state (`:92-102`) and a `handleSaveX` / `handleCancelX` pair (`:847-930`).
  - The access-tab state (`:131-137`), handlers (`:540-622`) and JSX (`:1628-1755`) are self-contained. The quality tab's JSX alone is `:1755-2458`, about 700 lines.
  - `canDeleteSurvey` (`:131`) is defined with the same expression as `canEditSurvey` (`:130`).
  - The sampling-frame upload and mode switch are copied almost verbatim from `CreateSurveyPage.tsx:186-265` into `SurveySettingsPage.tsx:656-745`: `handleTargetsModeChange`, `handleSamplingFrameUpload`, and six pieces of state.
  - The model to follow is already in this file: the transcription and translation tabs are delegated to `<AudioTranscriptionCard>` and `<TranslationCard>` at `:2458-2475`.
- **Why it matters:** to change one quality check, a reader scrolls through 55 state variables and four unrelated tabs. Every keystroke re-renders the whole page.
- **Proposed change (in this order):**
  1. `useCollectionTargets(koboToolData)` hook owning `samplingFrame`, `samplingFrameData`, file name, loading, validation error and note, `onModeChange` and `onUpload`. Used by both pages. This removes the duplication.
  2. `<SurveyAccessTab surveyId canManage onError onSuccess />` owning access-list state and handlers.
  3. `useSectionEditor(section)` returning `{ editing, saving, savedAt, startEdit, save, cancel }`, built on the existing `saveSection` queue (`:813`). This replaces the 7 flag pairs and 14 handlers.
  4. `<QualityChecksTab>` (general flags, outliers, LLM, custom checks) and `<GeneralSettingsTab>`. The page keeps loading, the tab layout and the banner.
- **Effort:** L, split into 4 PRs. Not safe without tests or types. F1 must come first. Then add Vitest + Testing Library smoke tests for one section's edit → save → cancel and for share/revoke on the access tab, with `progressApi` mocked. Step 1 is the lowest-risk start.

### F9. Dead code and unused dependencies

- **Severity:** minor (cheap and certain)
- **Evidence (each verified by grep to have no caller):**
  - **Frontend, unreachable files (865 lines):** `pages/ProgressTracker.tsx`, `pages/RuleBuilder.tsx` (plus `components/rule-builder/AINaturalLanguageInput.tsx`, `GlobalParameters.tsx` and `utils/file.ts`, reachable only from it), `components/HistoryViewer.tsx`, `JsonViewer.tsx`, `SurveySelector.tsx`, `utils/csvParser.ts`. Two of F1's type errors are in these files.
  - **Backend models and classes:**
    - `models.py:17` `QAStatus`. It is unused, and it also lacks `PENDING_RE_QA`, which `routers/progress.py:578` and `frontend/components/Badge.tsx:35` read but no backend code ever writes.
    - `models.py:370` `ErrorResponse`.
    - `routers/validation_rules.py:21-38` `ValidationRuleCreate`/`Update`: plain classes shadowed by the Pydantic `*Model` versions below them.
    - `routers/ai.py:41-49` `RuleCondition`, `RuleJoiner`.
  - **Backend functions:**
    - `services/permissions.py:79-106`: five `can_*_survey` functions, a second unused copy of the permission matrix.
    - `services/auth.py:288` `get_optional_current_user`, `:324` `set_user_kobo_token`.
    - `etl/audit_processor.py:209` `process_all_audits`, `etl/data_merger.py:467` `merge_submissions_batch`, `etl/kobo_fetcher.py:195` `get_submission_audit_url`, `etl/pipeline.py:399` `process_single_submission`.
    - `etl/hfc_engine.py:1368` `_compute_variable_statistics` (about 90 lines; only named in a docstring).
    - `routers/progress.py:99` `_extract_sampling_cols`, `etl/relevance.py:48` `_Unknown`, `linter/registry.py:53` `get_check`.
  - **Dependencies:** `pandas`, `jsondiff`, `pydantic-settings` in `requirements.txt`.
- **Why it matters:** each unused copy is something a reader must rule out. `can_edit_survey` disagrees with `require_survey_access` about what "edit" means, which is a trap for whoever finds it first.
- **Proposed change:** delete them, in one PR per side.
- **Effort:** S. Safe; the existing tests are the check. **Question:** are `ProgressTracker.tsx`, `RuleBuilder.tsx` and `PENDING_RE_QA` kept on purpose?

### F10. ORM models use the pre-2.0 `Column()` style, which hides every column's type

- **Severity:** notable
- **Evidence:** `database/models.py` (569 lines) declares every column as `x = Column(...)` on `declarative_base()` (`:24`, `:27-40`). Pyright therefore types `survey.config_data` as `Column[Any]`, and **916 of its 1230 errors** come from that. Examples: `dict(run.stats or {})` "expects `Iterable[list[bytes]]`" at `services/runs.py:142`, and `.get("success")` on a "`bytes`" dict at `routers/transcription.py:126`. The project pins SQLAlchemy 2.0.36, which supports `Mapped[...]`.
- **Why it matters:** this is the main reason a type checker is useless on the backend today. It also hides the real Optional bugs, such as `services/pull_worker.py:69-96`, which uses a query result without a `None` check.
- **Proposed change:** convert to `class Base(DeclarativeBase)` and `user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, ...)`, with `Mapped[X | None]` for nullable columns. No schema change; `tests/test_schema_parity.py` guards against drift. Separately, change `Field(None, description=…)` to `Field(default=None, …)` in `models.py` (for example `:36`) so pyright stops reporting 13 "missing argument `metadata`" errors in `etl/hfc_engine.py`.
- **Effort:** M, mechanical. Safe with the existing suite plus schema parity.

### F11. Error handling: swallowed exceptions and inconsistent error types

- **Severity:** notable
- **Evidence:**
  - `etl/hfc_engine.py:700-804` parses dates inline with five nested `except Exception: pass/continue` blocks. It also re-parses the configured `data_collection_start_date`/`end_date` for every submission (`:727`, `:744`). The same method has two docstrings (`:652` and `:658`; the second is a dead string literal) and two parameters, `start_time`/`end_time`, that are "kept for API compatibility but are NOT used".
  - 39 `except Exception` in app code (ruff BLE001).
  - "AI not configured" is detected three ways (`services/ai_client.py:128`, `services/ai_service.py:40/77`, `services/ai_allowance.py:60`) and raised as `ValueError` at `ai_service.py:114/322` but as `AIError(NOT_CONFIGURED)` at `:592/716`.
  - Frontend: 33 `catch` blocks only `console.error`. For example, `components/SubmissionDetail.tsx:171` leaves the panel without config, with no message.
- **Why it matters:** a misconfigured date silently disables a check, and the reader cannot tell which failures are expected. Callers of `AIService` must catch two exception types for one condition.
- **Proposed change:**
  - Add `parse_date(value) -> date | None` and `parse_time(value) -> time | None` helpers that catch `ValueError`/`TypeError` only. Parse the configured dates once in `__init__`. Drop the unused parameters and the stray docstring.
  - In `ai_service.py`, raise `AIError(NOT_CONFIGURED)` everywhere and let routers map it (as `rule_error_message`, `:22`, already does).
  - Enable `BLE001` with justified `noqa`s where a blanket catch really is intended (worker top-levels).
- **Effort:** S. Covered by `test_hfc_engine.py` (972 lines) and `test_ai_*`.

### F12. Minor findings, each S effort

- **Status strings are bare literals.** `"pending", "running"` tuples are spelled out in ten places (`services/ai_allowance.py:121,192`, `routers/transcription.py:396`, `services/transcription_runtime.py:203,399`…), next to constants that exist for the same thing (`services/runs.py:49-51`, `services/translation_queue.py:54`). The AI "in progress" set is duplicated between `routers/submissions.py:248` and `services/runs.py:49`. Proposal: `StrEnum`s next to `RUN_ACTIVE` in `database/models.py`, with `OPEN = (PENDING, RUNNING)`.
- **Parallel transcription/translation pipelines copy leaf helpers.** `_backoff_seconds` appears three times, identically (`services/transcription_worker.py:17`, `translation_worker.py:17`, `qualitative_worker.py:29`). `sweep_stalled_transcripts` (`transcription_runtime.py:409`) and `sweep_stalled_translations` (`translation_runtime.py:206`) have the same shape. Move the helpers into `services/job_queue.py`. Do **not** build a generic pipeline framework; the two flows differ where it matters. **Question:** `routers/transcription.py:130` counts `skipped` inside `not_run`, while `routers/translation.py:156` reports it separately. Is that intentional?
- **`run_problems` is 230 lines of near-identical `if failed.get(x): problems.append({...})`** (`services/runs.py:356-585`, 18 appends). A table of `(source, error_category, kind, text, action)` rows with one loop would make the user-facing copy reviewable in one place.
- **Configuration is read with `os.getenv` in 19 modules (47 calls).** `pydantic-settings` is installed but unused (F9). A single `settings.py` would document every variable. Keep this low priority: the current reads are commented and work.
- **Component defined inside render.** `App.tsx:165` (`NavButton`) is recreated on every render, along with 11 similar cases ESLint flags (`TranslationCard.tsx:342`, `QualityScatterPlot.tsx:143`…). Hoist them to module scope.
- **Double fetch.** `components/Dashboard.tsx:133` loads the survey config and passes it to `SubmissionFilters`, but its child `SubmissionDetail.tsx:163-177` fetches the same config again. Pass it down. The qualitative-issue test is also written twice in one file (`SubmissionDetail.tsx:220` and `:410`).
- **Naming.** `backend/models.py` holds Pydantic API schemas and `backend/database/models.py` holds the ORM. Two modules named `models` with different meanings; renaming the first to `schemas.py` would remove a recurring double-take. The request/response models in routers (27 in `models.py`, plus 22 inside routers) could follow it. Also, only 23 of 71 endpoints declare a `response_model`.
- **`etl/pipeline.py:19-22` imports Celery queuers from `services/`,** so the ETL package cannot be used or tested without the worker stack. Consider passing the queuers in, as `HFCEngine` already does with `fetch_live_form`.

### F13. Tests: mostly behavioural, with a few couplings that will slow refactors

- **Severity:** minor
- **Evidence:**
  - The suite mostly drives the API through `TestClient`, which is a good base for F3/F4.
  - The SQLite type shims (`JSONBForSQLite`, `UUIDForSQLite`) are copied four times: `tests/conftest.py:21-75`, `test_api_endpoints.py:23-80`, `test_auth_endpoints.py:30-80`, `test_error_responses.py:34`.
  - `tests/test_hfc_engine.py` makes 32 private-member accesses (`engine._check_duration`, `engine._get_field_value`…), so F2 and F11 will break tests without breaking behaviour.
  - Coverage gaps: `routers/quality.py` 14%, `routers/submissions.py` 39%, `routers/ai.py` 35%, `services/ai_service.py` 38%.
  - The frontend has no tests at all.
- **Proposed change:**
  - Move the shims into one `tests/sqlite_compat.py` (or a session fixture in `conftest.py`).
  - Before F2/F11, rewrite the private-method tests against `HFCEngine.run_checks(...)`, asserting on the returned `QualityIssue`s.
  - Add the characterization tests listed in F4.
  - Add Vitest (`npm i -D vitest @testing-library/react jsdom`) when starting F6.
- **Effort:** S–M.

## 4. Known debt the repo already acknowledges

- **B904** is deferred, not dismissed (`backend/ruff.toml:24-30`). The comment says 44 sites; current ruff counts **42**. 24 of them disappear with F3.
- **B008** is ignored for FastAPI `Depends` defaults (`ruff.toml:22`). The modern fix is `Annotated[...]` (ruff FAST002, 168 sites), which would make the ignore unnecessary.
- **E501** is left to the formatter (`ruff.toml:21`).
- **`byDistrict`/`byLivelihood` legacy fields** are still emitted (`routers/progress.py:431-442`) and still typed in `frontend/types.ts:168-169`. No frontend code reads them.
- **The unused `start_time`/`end_time` parameters** are "kept for API compatibility" (`etl/hfc_engine.py:654-656`). The only caller is internal, so there is no external API to keep compatible.
- **The schema lives in three places** (`database/schema.sql`, ORM models, Alembic), guarded by `tests/test_schema_parity.py` and documented in `backend/database/README.md`.
- **Submissions are filtered in Python after loading all rows** (comment at `routers/submissions.py:270-272`). This is already tracked as finding F-01 / option A in `docs/ui-ux-review/REPORT.md:468`.
- **The `xlsx` dependency is fetched from `cdn.sheetjs.com`** (`package.json:17`). That is deliberate (SheetJS no longer publishes to npm), but `npm ci` fails wherever that host is blocked.

## 5. Suggested sequence

Each step is one shippable PR that leaves tests green.

1. **Frontend types and CI (F1).** Add `@types/react{,-dom}`, fix the 11 errors, enable `strict`, add the `frontend` CI job (tsc + build).
2. **Dead code (F9).** Delete the unreachable files and functions and the three unused Python deps. Then enable `noUnusedLocals`/`noUnusedParameters` and fix the remainder.
3. **Upgrade ruff (§2).** Pin a current ruff, fix the 3 new hits, add SIM/RET/PERF/RUF/PLE/PLW and C901 at 25 (77 hits, 24 auto-fixable), and add the `tests/**` RUF012 ignore. Mechanical.
4. **Shared helpers (F2, F12 leaves, F13 shims).** Add `forms/answers.find_answer` with its unit test, `job_queue.backoff_seconds` and `tests/sqlite_compat.py`. First rewrite the private-method tests in `test_hfc_engine.py` against `run_checks`.
5. **`survey_access()` dependency (F3).** Roll it out one router per commit. Clears 24 B904 sites; re-count the B904 comment.
6. **`Mapped[...]` ORM and pyright ratchet (F10, §2).** Convert the models, fix `Field(default=None)`, add pyright basic on the clean-module include list in CI, then widen it.
7. **Routers → services (F4).** *Before:* characterization tests for `/quality-overview` and `/submissions` filters, and the owner's decision on the missing-answer semantics. Then extract `services/progress.py` and `services/submission_filters.py`.
8. **Typed survey settings (F5) and error handling (F11).** Pydantic `SurveySettings`, date helpers parsed once, consistent `AIError`, enable BLE001.
9. **Frontend request layer and navigation (F6, F7).** *Before:* Vitest plus tests for `request()`. Then migrate the API modules and introduce `NavigationContext`, and run the manual navigation checklist in the PR.
10. **Split `SurveySettingsPage` (F8).** *Before:* Testing Library smoke tests for one section's save/cancel and for the access tab. Then `useCollectionTargets` (shared with `CreateSurveyPage`), `SurveyAccessTab`, `useSectionEditor`, `QualityChecksTab`, one PR each. Lazy-load `xlsx` in the same series (only the two upload parsers use it).

### Not committed with this report

The optional mechanical-fix commit is empty, so I did not make one:

- With the pinned ruff 0.1.15, `ruff check --fix` and `ruff format` change nothing.
- vulture's high-confidence hits are all intentional.
- knip's unused exports are either a deliberate icon set (`components/ui/icons.tsx`) or would require deleting code rather than just dropping an `export`.

The 3 hits from a newer ruff belong in step 3, together with the version bump, so that CI and local runs agree.

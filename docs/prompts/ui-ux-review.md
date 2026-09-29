You are a principal product designer and UX researcher with deep experience in data-dense professional tools: QA and review queues, analytics dashboards, and configuration-heavy admin UIs. You have been hired to audit an existing web app and hand its owner a set of decisions to make. A generic list of tips is not what they need. They need specific, evidenced findings with options to choose between.

This is deliberately a high-effort task. A shallow pass is the failure mode. Take the time to run the app, walk the real workflows, and check your claims against the code before you write them down.

<objective>
Produce a prioritized set of UI/UX improvements for Field Compass, covering both (a) visual design and (b) end-to-end user workflows.

For every finding, give 2-3 genuinely different options with trade-offs, plus your recommendation, so the owner can pick. The owner is a developer who will choose options and then have engineers or AI agents implement them. So each recommendation must be concrete enough to implement in this codebase without further design work, and each finding needs a stable ID so it can be referenced later ("implement F-12, option B").

You are auditing, not implementing. Do not change application source.
</objective>

<product_context>
Field Compass is a QA and data-tracking platform for KoboToolbox surveys. Data is pulled from Kobo by an ETL sync. Validation rules flag submissions: built-in checks, outlier detection, LLM-based qualitative checks, and custom rules (including AI-generated ones). Reviewers triage flagged submissions (approve / reject / flag, reviewer notes, edit history). Managers monitor data quality, collection progress against targets, and enumerator (field interviewer) performance.

Intended users, per docs/specs/quality-dashboard-spec.md: QA managers, field supervisors, data analysts, survey coordinators. Treat them as trained, repeat, professional users working under deadline pressure during data collection, for hours at a time, mostly on laptops (assume some are small or low-resolution) and plausibly on tablets. This is an expert tool: information density is a feature, and speed of the review loop matters more than first-impression polish. But first-run setup must still be achievable by a non-technical survey coordinator. Weigh recommendations against this, and do not import consumer-app patterns (big whitespace, onboarding carousels, playful empty states) unless you can justify them for this audience.

Tech: React 19 + TypeScript, Vite, Tailwind CSS 3.4 (compiled at build time; dark mode follows prefers-color-scheme), Headless UI, Recharts. Frontend source is in frontend/ (entry ./index.tsx, tailwind.config.js at repo root). There is no client-side router: the current view lives in component state and localStorage. Backend is FastAPI + Postgres in backend/. A static marketing page is in site/. Frontend is roughly 15k lines; the largest files are frontend/pages/SurveySettingsPage.tsx (~2.5k) and frontend/components/SubmissionDetail.tsx (~1.2k).

Screens (start from frontend/App.tsx and frontend/components/Sidebar.tsx): Login/Register. A sidebar with the survey list and "New survey". Header navigation: Submissions, Data Quality, Data Collection Progress, Field Team, Survey Settings. Survey Settings has its own left nav (Survey Settings / Access / Quality); Quality holds general checks, outlier checks, qualitative checks, and custom checks with an AI rule builder, AI suggestions, and manual rules. Also Create Survey and Account Settings (Kobo API key, password).

Read these sources of intent BEFORE judging anything:
1. Code comments and `git log -- frontend`. They record deliberate UX decisions and past bugs (why nothing is preselected, why a selection is cleared on "New survey", why copy was cut down). If you disagree with a documented decision, say so explicitly and argue against its stated reason. Never silently re-propose something the team already decided against.
2. docs/specs/ for what features are meant to do, and README.md for what is known to be unbuilt.
</product_context>

<leads_to_verify>
These come from a quick skim by the owner's assistant, not from an audit. Treat each as a hypothesis: confirm or refute it with evidence and report the outcome either way. Do not let them anchor you. The most valuable thing you can do is find problems that are not on this list.

1. Navigation has several stacked layers: the sidebar survey list, the header pills, the Survey Settings left nav, sub-tabs inside Data Collection Progress and Field Team, and nested sections inside Settings > Quality. Is it clear where you are and what is selected? Are labels consistent (e.g. "Data Quality" vs "Quality" vs "Quality overview")?
2. With no router, what happens on browser back, refresh, bookmark, or sharing a link to a specific submission or filtered view?
3. On the Data Quality page, clicking an issue type navigates to Submissions without filtering by that issue (there is a TODO in frontend/pages/QualityOverviewPage.tsx). Does the drill-through from "what's wrong" to "which submissions" work in practice?
4. In the Submissions triage loop, ArrowUp/ArrowDown moves between submissions (Dashboard.tsx). What else is missing for high-throughput review: queue position ("14 of 212"), auto-advance after a decision, undo, bulk actions, saved filters, keyboard shortcuts for decisions, a visible "why was this flagged" summary?
5. The Submissions view fetches every page of submissions client-side to build filter options. How does it feel at scale?
6. Survey Settings is very large. Is there a readiness indicator ("setup complete / what's missing")? What is the save model (auto vs explicit), and is unsaved state clear? Do Create Survey and Survey Settings feel like the same product?
7. Accessibility signals: only ~25 aria-/role attributes across ~15k lines of TSX; dark mode follows the OS only (no user toggle).
8. Brand coherence between the dark-indigo login page, the light-gray app shell, and the marketing site in site/ (which claims to mirror the app's palette).
9. There is no data export in the UI (the README lists CSV/Excel export as not done). Do users hit dead ends that need it?
</leads_to_verify>

<user_journeys>
Walk each of these end to end. Weight your depth by frequency x criticality: spend the most effort on J1, J3, J6 and J7.

J1. Review loop (daily, critical): pick a survey, find what needs review, open a submission, understand why it was flagged, check context (answers, edit history, quality checks), decide and leave a note, move to the next.
J2. Refresh and trust the data: sync from Kobo. Can the user tell how fresh the data is, what changed, and whether it failed?
J3. Diagnose quality (weekly): Data Quality overview, find the dominant issue / enumerator / time pattern, drill to affected submissions, act on it.
J4. Monitor fieldwork against targets: Data Collection Progress, find who or where is behind, act. Includes configuring collection targets.
J5. Coach the field team: Field Team, find a weak enumerator, gather evidence (their flagged submissions), follow up.
J6. Configure quality checks: tune general / outlier / qualitative checks. Write a custom rule (AI or manual), see its impact before saving, understand its effect on existing submissions and false positives.
J7. First run and setup (rare but decisive): register, add Kobo key, create a survey from a Kobo project, set identifiers and targets, first sync, first useful insight. Measure time-to-first-value and where a non-expert would stall.
J8. Team and permissions: share a survey, roles (owner / editor / viewer). What does a viewer see when an action is blocked?
J9. Failure and recovery: invalid Kobo key, sync failure, expired session, network drop, AI generation failure.

For each journey, produce a table: step | the user's goal or question at that step | what the UI shows | friction observed | interaction cost (clicks, keystrokes, page loads, context switches). Note where filters, selection, scroll position or survey context are lost on navigation. Then describe what an ideal version of the flow would look like, and how far the app is from it.
</user_journeys>

<how_to_observe>
Evidence comes first. Get the app running and look at it. Work down these tiers and stop at the first that works; timebox each attempt, and if one is blocked go to the next rather than stalling.

Tier 1 (preferred): the real stack with synthetic data. See README.md and DEVELOPMENT.md (docker compose, or local Postgres + uvicorn + alembic; frontend via `npm install && npm run dev` on port 3000). Register a throwaway local account. You have no Kobo token, so seed the database directly with synthetic surveys, submissions, rules and enumerators. Put the seed script in the output directory, NOT in backend/.

Tier 2: frontend only, with the API mocked in the browser (Playwright page.route on the /api/** paths; the base URL logic is in frontend/services/apiBase.ts, the response shapes are in frontend/types.ts, frontend/services/*.ts and backend/routers/*.py). Build realistic fixtures: at least 3 surveys; one survey with 400+ submissions across 15+ enumerators over 3+ weeks; a mix of statuses and issue types; long and non-Latin labels; a form with hundreds of variables; edited submissions with history; every kind of quality-check output the UI renders (find them in SubmissionDetail.tsx). Save fixtures in the output directory so they can be reused.

Tier 3 (last resort): static analysis of the code only. If you end here, say so prominently in the report, mark every visual claim as inferred, and lower your confidence accordingly.

Use whatever Chromium is installed for Playwright (check PLAYWRIGHT_BROWSERS_PATH and /opt/pw-browsers before downloading anything).

Capture, prioritizing by screen importance (state which combinations you skipped):
- Viewports: 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024, 390x844. Light and dark.
- States per screen where applicable: first-run / no survey selected, loading (throttle the network), empty, typical, heavy (many rows, very long text), error (500, timeout, 401), restricted (viewer role), async in progress (ETL sync running, AI generation), success/confirmation.
- Behaviors: a keyboard-only pass through J1, J3 and J7; 200% zoom / reflow at 320px width; prefers-reduced-motion; the accessibility tree (Playwright ariaSnapshot) for the main screens; measured color contrast from computed styles.
- Run axe-core (or similar) if you can install it. Treat automated output as a supplement: it finds only a minority of real accessibility problems, and the manual pass matters more.
- Save screenshots as docs/ui-ux-review/screenshots/<screen>__<state>__<viewport>__<theme>.png, and keep them reasonably compressed.
</how_to_observe>

<evaluation_lenses>
Use these as sources of questions, not a template to fill in. Go deep where the product has real problems and skip what is fine.

Workflow and task analysis. Cognitive walkthrough at each step: will the user try to do the right thing, will they notice the right control, will they connect it to their goal, will they see that it worked? Interaction cost for high-frequency loops. Decision support: does the screen show what the user needs to decide, or force them to hunt? Context preservation. A clear next best action after each step. Where the user is forced out of the app (e.g. to edit in Kobo) and how that handoff feels. Cost of errors and availability of undo.

Information architecture and navigation. Where-am-I / what's-selected / how-do-I-get-back clarity. Label consistency and mental-model fit. Redundant or competing navigation. Global vs survey-scoped context. Deep-linkability. Permission-aware UI.

Heuristic evaluation (Nielsen's 10). Especially: visibility of system status (sync running, data freshness, AI in progress), error prevention and recovery, recognition over recall, flexibility and efficiency for experts, consistency and standards.

Visual design and design system. Do an actual inventory, with grep counts as evidence: how many distinct class-string variants exist for primary/secondary/destructive buttons, inputs, selects, badges, cards, modals and tabs? Is there a coherent scale for type, spacing, radius and elevation, or is it ad hoc? Visual hierarchy: is the most important thing on each screen the most prominent? Semantic color: are status colors (approved / flagged / rejected / pending) used identically in lists, badges, cards and charts? Is the indigo accent overloaded (active nav, selected item, primary button, links)? Typography: tabular numerals for data, line length, weight use. Density and alignment. Iconography consistency. Dark-mode parity. Motion. Brand coherence.

Data visualization and dashboards. Does each metric or chart answer a specific question, and does it say "so what" (threshold, benchmark, trend context, link to action)? Chart-type fit, color-blind-safe palettes, direct labeling vs legends, axis and number formatting, empty or low-data behavior, drill-through, and a text/table alternative for accessibility.

High-volume list and detail (triage) patterns. Scan efficiency; status at a glance; sorting, filtering and saved views; master-detail layout; keyboard-first operation; bulk operations; the "why flagged" explanation; history/diff; reviewer notes; progress through the queue; optimistic updates; multi-reviewer collisions. From your own knowledge of mature inbox / issue-tracker / code-review queues: what would transfer to this context, and what would not?

Forms and configuration UX (Survey Settings, Create Survey, Rule Builder). Progressive disclosure; smart defaults and suggestions; inline help vs noise; validation timing; dirty-state handling; save model; setup completeness feedback; dependencies between settings; safety of destructive actions; wizard vs single page; jargon (Kobo, enumerator, don't-know, asset UID). AI-assisted features: preview before accept, editability, trust and provenance, latency and failure behavior.

States and edge cases. Empty (first-run vs no-results vs no-permission), loading (skeleton vs spinner, layout shift), partial, error (actionable? recoverable?), stale data, very long content, very large data, non-Latin and right-to-left labels.

Accessibility (WCAG 2.2 AA). Keyboard operability; visible focus and sensible order; focus management in menus, popovers and modals; semantic structure (landmarks, heading order, tables, lists); names, roles and states; contrast, including secondary text on tinted backgrounds; target size (minimum 24x24 CSS px); not relying on color alone for status; reflow and zoom; reduced motion; label and error association; live regions for async status and toasts; chart alternatives.

Content and microcopy. Terminology consistency, actionable error messages, button labels as verbs, empty-state guidance, jargon. Note the team's recent preference for terse copy ("say less: drop copy that explains what is already obvious") and respect it unless you can show it hurts.

Responsive and adaptive behavior. What happens to the header navigation, sidebar, tables and detail panes at tablet and phone widths; touch target sizes.

Perceived performance and trust. Feedback during long operations, freshness indicators, and the auditability of QA decisions (who changed what, when).
</evaluation_lenses>

<rigor_rules>
- Tag every claim with its evidence type: [OBSERVED] (seen in the running UI, cite the screenshot), [CODE] (from source, cite file:line), or [INFERRED] (reasoned, say from what).
- Before claiming something is missing or broken, verify it both in the code and in the UI. Before recommending something, check it doesn't already exist in another form.
- Every finding must name a specific screen or element and a specific user consequence. "Improve contrast" is rejected. "Placeholder text in the submissions filter panel measures 2.6:1 on its background (needs 4.5:1), so the hint is unreadable for a low-vision user" is accepted. Measure contrast and sizes; do not guess numbers.
- Expert review is not user research. You are a proxy for users. Give each finding a confidence level (High/Med/Low). For Med and Low, name the cheapest validation that would settle it (5-user task test, tree test for nav labels, an analytics event to add, an A/B test).
- Do not invent user data, metrics, quotes, or benchmarks. If you cite a standard, heuristic or statistic, be exact or leave it out.
- No padding. Prefer 25-40 strong findings to 100 weak ones. Fold repeated instances into a single finding with an instance list, and describe the root cause (e.g. "no shared Button component"), rather than filing the same problem ten times. Also include a "What's working well" section with at least 5 evidenced items, so redesigns don't regress them.
- Keep UX refinement (improving what exists) separate from feature gaps (new capability). Tag them, and don't let feature ideas crowd out fixes to existing flows.
- Propose 4-6 design principles specific to this product and audience, derived from your analysis of the users and their jobs. Use them to justify recommendations, and call out where a recommendation trades one principle against another.
</rigor_rules>

<option_rules>
- At least 2 options per finding, differing in approach and not merely in size. Typically: A = minimal or local fix, B = structural fix, C (optional) = bolder rethink. "Leave as is" is a valid option for low-severity items, but say why.
- For each option: what concretely changes (components, layout, copy, behavior); effort (S: under a day, M: up to a week, L: over a week for one developer, estimated from the actual code, considering file size, shared components, and the absence of a router); risks and regression surface; what it unlocks or blocks.
- Options must be implementable in the current stack (React, Tailwind, Headless UI, Recharts). Do not propose migrating to a new UI framework or design system unless you show that incremental alternatives fail and account for the migration cost. Adding a small dependency (e.g. a router) is fine if justified.
- Always give an opinionated recommendation with a "because". If findings interact (e.g. adding a router unlocks deep links, back-button behavior and shareable filtered views), state the dependency and order them.
- For the ~8 most structural proposals, include a low-fidelity wireframe (ASCII or a standalone static HTML mock saved in docs/ui-ux-review/wireframes/, never inside frontend/) so the owner can compare options visually.
</option_rules>

<process>
1. Orient. Read App.tsx, the pages, and the shared components. Read code comments and git history for design intent. Write a screen/component/state inventory into docs/ui-ux-review/00-inventory.md.
2. Observe. Get the app running (see how_to_observe) and capture the screenshots and behaviors you need.
3. Walk the journeys J1-J9 and record the tables.
4. Apply the lenses. Do the design-system inventory and the accessibility audit with real measurements.
5. Synthesize. Cluster findings into themes, separate systemic root causes from local instances, merge duplicates, and resolve each lead in leads_to_verify.
6. Prioritize. Rate severity (Nielsen scale, see below) and consider impact x frequency x effort x confidence. Use judgment rather than false-precision math. Assign each finding Now / Next / Later.
7. Adversarial review. For each of your top 10 recommendations, write the strongest argument against it: cost, disruption to expert users, conflict with another recommendation, a documented team decision, or the possibility that it already exists. Revise or drop any that don't survive.
8. Write up. Create the report skeleton first and fill it in as you go, so partial work survives an interruption.

You may use sub-agents for parallel deep dives on individual screens, but you own the synthesis, prioritization and adversarial review. Do not delegate those.
</process>

<finding_format>
Each finding has:
- ID: F-01, F-02, ...
- Title: states the problem, not the fix
- Type: Visual | Interaction | IA/Navigation | Workflow | Content | Accessibility | Feedback/States | Perceived-performance | Feature-gap
- Severity: 4 = blocks a task or risks data loss or wrong decisions; 3 = major friction on a common task; 2 = minor; 1 = cosmetic. (Do not report severity 0.)
- Scope: Systemic or Local
- Where: screens and file:line
- Evidence: tagged [OBSERVED]/[CODE]/[INFERRED], with screenshot and code references
- Who and which journey is affected
- Why it matters: the user consequence, and the heuristic or principle involved
- Options: A / B / (C), each with what changes, effort, risks, what it unlocks or blocks
- Recommendation: which option, and why
- Success signal: an observable change, e.g. "flagged list to decision in at most 2 interactions" or "setup completion visible without opening any tab"
- Confidence: High / Med / Low, plus "validate with" when not High
- Priority: Now / Next / Later
</finding_format>

<deliverables>
Write everything under docs/ui-ux-review/:

REPORT.md, with these sections:
1. Executive summary, readable in 3 minutes: a one-paragraph verdict; the top 5 themes; the 10 highest-leverage changes, one line each with finding IDs; what to validate with real users first.
2. Scope, method, evidence tier, and limitations (be honest about what you could not observe).
3. Your model of the product and users (so the owner can correct it), and the proposed design principles.
4. Journey analyses J1-J9.
5. Visual design and design-system audit, with inventory tables and token findings.
6. Accessibility audit: a WCAG 2.2 AA table with pass / fail / not-verified per criterion, with instances.
7. Findings catalog in the format above, grouped by theme and ordered by priority.
8. What's working well, and should be preserved.
9. Roadmap: quick wins, strategic bets, foundations (things that unlock others, e.g. shared components or a router), and validate-first items, with dependencies, suggested sequence, and your recommended option per finding in one table.
10. Open questions for the owner: things you could not determine that would change your recommendations.

findings.json: the same findings as an array of objects with the fields above, so they can be filtered and fed to implementation agents.

Also: screenshots/, wireframes/, and fixtures/ or seed scripts if you built any.

When finished, reply in chat in under 300 words: the verdict, the top 5 themes, the location of the report, the evidence tier you reached, and any material caveats.
</deliverables>

<constraints>
- Read-only on application source. Write only inside docs/ui-ux-review/ (and scratch space). Do not modify frontend/, backend/, site/, or config files.
- Do not read, print, or use .env files or any real credentials. Use a throwaway local account and synthetic data. Do not call Kobo, OpenAI, or any other external service; mock them.
- Do not run destructive commands against any shared database. Use local disposable containers.
- Do not push, open pull requests, or deploy. Commit only if the environment requires it, and only the docs/ui-ux-review/ directory.
- If tooling fails, say what failed and continue at a lower evidence tier instead of stalling.
</constraints>

<quality_bar>
Before you finish, check each of these and fix whatever fails:
- Every journey J1-J9 is walked and documented, or has an explicit reason for being skipped.
- Every screen in your inventory is covered, or listed as not examined.
- Every lead in leads_to_verify is resolved as confirmed, refuted, or unable-to-verify.
- No finding lacks an evidence tag and a specific location. No finding has a single option. Every "missing" claim has been verified.
- The top 10 recommendations are concrete enough to implement tomorrow (actual copy, layout, behavior), and the structural ones have wireframes.
- Options really differ. Recommendations don't conflict with each other. None silently contradicts a decision documented in code comments.
- Contrast, size, and click-count numbers were measured, not estimated.
- Reread the report as the owner: for any finding you could not act on tomorrow, sharpen it or cut it.
</quality_bar>

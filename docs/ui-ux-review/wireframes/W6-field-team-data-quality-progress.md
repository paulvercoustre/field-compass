# W6 — Field team, Data quality and Progress: one job each, one set of counts (F-08, F-10)

The design pass from [Next five](../REPORT.md#next-five) item 1, decided on 2026-10-09. Wireframes are on the
[design canvas](https://claude.ai/artifact/XNYePxNz8F75JZmAj3iXJB): boards 0.1–0.2 (purpose and counts), A1–A3 (the three
pages), C1 (call sheet), D1 (states) and E1 (by question). Boards B1–B2 are the option that was not chosen. It
supersedes [W2](W2-field-team-metrics.md), which showed names: Field team keeps enumerator IDs.

The example numbers are the review's synthetic survey: 147 submissions, 36 Approved, 10 Not approved, 44 Needs
review, 67 flagged, 137 of a target of 160. Splits by enumerator, check and question are made up to add up.

## Decisions, 2026-10-09

- **Three pages, one job each** (option A), plus a call sheet per enumerator (option C) for targeted feedback. Field team
  does not merge into Data quality (option B).
- **No fifth tab.** Problem questions and form problems are a third way to look at Data quality: Overview, By check,
  By question.
- **Progress tracks collection apart from quality.** It shows what is done, every submission except Not approved,
  against the target, and the Approved part of it. In the intended workflow every submission is reviewed, so the
  rest shrinks to nothing. No daily objective per enumerator.
- **Don't-know rate:** don't-know answers out of the questions that allow one, never out of every field.
- **Duration:** the audit log's active time, else the time from the start question to the end question, on every
  screen, the way the duration check measures it.
- **Issues per submission:** issues ÷ submissions, every submission counting once. Most useful as a trend, by day, as
  bars: on Data quality, and per enumerator on the call sheet against the team's. Flagged share is the headline.
- **Highlighting is driven by flags, against the team:** a cell is highlighted when an enumerator's share flagged by a
  check, or their Not approved share, is at least twice the team's. Duration and don't-know rate are shown plain;
  the checks carry the verdict. With checks off, nothing is highlighted.
- **Not approved is a major signal:** its own column on Field team, first on the call sheet.
- **Default period: the whole survey.** The period menu calls it All time, beside Last 7 days and Last 30 days.
- **"Flagged" and "Clean"** as named below, the same on every tab.

## What each page is for

| Page | Question | For | Opens |
|---|---|---|---|
| Progress | Will we reach the sample, and where are we behind? | Owner, M&E lead, viewers. Weekly | Submissions for a group; Settings › Targets |
| Data quality | What is going wrong in the data, where in the form, and how far has review got? | Data manager, lead reviewer. Daily | Needs review for a check; a review tab; a question's answers; Settings › Checks, Form check |
| Field team | Which enumerator needs a call, and about what? | Field coordinator. Daily to weekly | One enumerator's call sheet; their Needs review |

Review progress: done in Submissions; its home is Data quality (one bar of the named counts, and the oldest
submission still waiting); one grey Reviewed column on Field team, never coloured or ranked; the Approved part of the
bar on Progress.

## Named counts

Used word for word on every screen; the ⓘ text is the definition. `services/metrics.py` computes all of them, and
`frontend/utils/glossary.ts` holds the words.

| Name | Definition | Notes |
|---|---|---|
| Submissions | Every submission pulled from Kobo, except deleted ones. | Field team's team figures include submissions with no enumerator, so they match Data quality's; those are a row of their own, never counted, ranked or highlighted as an enumerator. |
| Flagged | At least one check found an issue, whatever a reviewer decided. | |
| Issues | What the checks found. A flagged submission can have several. | |
| Needs review | Flagged, and no decision in Kobo yet. | The Submissions tab. |
| On hold | A reviewer marked it On hold in Kobo. | |
| Clean | Not flagged, and no decision in Kobo yet. | |
| Reviewed | A reviewer marked it Approved or Not approved in Kobo. | Approved + Not approved. |
| Approved | A reviewer marked it Approved in Kobo. | |
| Not approved | A reviewer marked it Not approved in Kobo. | Never counted toward the target. |

Submissions = Needs review + On hold + Clean + Approved + Not approved, always.

| Measurement | Rule |
|---|---|
| Duration | Median interview length: active time from the audit log, else from the start question to the end question (`etl/duration.py`, shared with the duration check). Pauses count when it comes from start and end; the screen says so. |
| Don't-know rate | Don't-know answers out of the answers to questions that allow one (`etl/dk_utils.py`), pooled over the submissions. |
| Issues per submission | Issues ÷ submissions. |

Retired words: Validated, Not Reviewed (as a count), Flagged not yet approved, Interviews conducted, Often flagged,
Total issues across…

## Field team (A1, with C1)

```
┌ Field team ─────────────────────────────────────── Period [All time ▾]   Last pulled 2 h ago  [Pull] ┐
│ ┌ Flagged 45% ┐ ┌ Duration 27 min ┐ ┌ Don't-know 2.6% ┐ ┌ Checks on 8 ┐ ┌ Reviewed 32% (grey) ┐       │
│ 4 submissions have no enumerator recorded. They count in the team's figures, not as an enumerator.   │
│ Who to follow up with                                                   [Find an enumerator ID]       │
│ Enumerator │ Subs │ Flagged      │ Not approved │ Main issue               │ Duration │ DK  │ Reviewed │NR │
│ Whole team │ 147  │ 46%          │ 7%           │ Interview too short ×38  │ 27 min   │2.6% │ 46 of 147│ 42│
│ enum_07    │ 32   │ ▇▇▇▇ [100%]  │ [25%]        │ [Interview too short ×32]│ 6 min    │5.9% │ 9 of 32  │ 20│
│ enum_03    │ 22   │ ▇▇ 41%       │ 5%           │ Outside office hours ×6  │ 29 min   │0.4% │ 6 of 22  │  6│
│ … Too few submissions to compare (under 5): enum_08                                                  │
│ No enumerator recorded │ 4 │ 50% │ 0% │ …   (last, never sorted among the enumerators or highlighted)   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
[ ] = highlighted: at least twice the team's share. Columns sort from their heading. A row opens the call sheet;
the Needs review count (NR) opens that enumerator's Needs review.
```

**Main issue** is the check that flagged most of their submissions, with one at twice the team's share first, so the
column names what to talk about, not what everyone gets. "Checks on" is one number, the survey's own checks included,
with a link to Settings; with none on, a line says nothing has been flagged and that this doesn't mean the data is
clean. A period with no submissions says so.

The call sheet (C1) has its own address, `/surveys/<id>/team/<enumerator>`, and Back returns to the table. The team
stays beside it as a scrolling list in the Submissions list's form: one row each (ID and submissions, then Flagged,
Not approved and a highlighted main issue as tags), the open one marked. In order: Not approved and Flagged against
the team; duration, their interviews as dots over the team's middle half and median; the don't-know rate against the
team; the checks that flagged them, as a small table (check, their share with the count, the team's share, a link to
those submissions); their submissions in review (Needs review, On hold, Clean, Approved, Not approved); issues per
submission by day as bars, with the team's figure as a dashed line; and a plain summary to copy into a message or
read on the call. Buttons open their Needs review and all their submissions.

Removed: the five summary cards, the ranking card, the submissions bar chart and the scatter.

## Data quality (A2, E1)

The views sit in the address, `/surveys/<id>/quality` and `/surveys/<id>/quality/by-check`, behind a switch at the
top; the period menu is Field team's (All time, Last 7 days, Last 30 days).

- **Overview:** the review card: submissions and how many are Reviewed, how long the oldest submission still in Needs
  review has waited, a button to open Needs review, and one bar of Needs review, On hold, Clean, Approved and Not
  approved, each below it as a box that opens its tab (Clean has none). Then Field team's tiles without Reviewed:
  Flagged, Duration, Don't-know rate, Checks on. Then two charts by day, Flagged and Issues per submission, each a
  share of that day's submissions as bars, with the whole period's figure as a dashed line named in the legend. With
  no checks on, a line says so first.
- **By check:** each check that flagged something, most first: submissions flagged, share of submissions, the share of
  each day's submissions it flagged on the 14 days up to the last submission in the period, the enumerator it flags most (with how many of theirs, highlighted at twice
  the team's share, opening their call sheet), and its Needs review count. A check's name opens every submission it
  flagged; the count opens those still waiting. Built-in checks that are on and flagged nothing follow with 0, then
  those that are off, under "Off: these checks did not run", each with a link to Settings. Outliers are named by
  their question.
- **By question (E1):** every question, the ones to look at first on top.

| Column | Rule | Looked at when |
|---|---|---|
| Asked in | Share of submissions the question was shown in, from its condition and its group's (`etl/relevance.py` evaluates them, as the blank check does); the condition beside it. Where a condition can't be evaluated, the share answered, said as such. | Under 10% with a condition ("Rarely asked"); 0% with a Form check finding ("Can never be shown"). |
| Don't-know | Don't-know answers out of answers, for questions that allow one; how many enumerators record it. | 20% or more. Spread across the team points at the wording; one enumerator, at them. |
| "Other" | Share choosing Other. | 20% or more: the list may be missing an option. |
| Flagged | Outlier and AI review findings on the question. | |
| Corrected | Submissions where the answer was edited in Kobo (edit history, since #94). | 3 or more. |

Time per question needs the audit processor to keep per-question times (`etl/audit_processor.py` keeps totals); later.

**Quality by day is always a share of the day's submissions, never a count** (2026-10-10). How many came in on a day is
progress: a busy day must not look worse than a quiet one. So Data quality draws no submissions-per-day chart; Progress
will have its own time series (step 4). Shares on days with few submissions are noisy; the tooltip gives the numbers
behind each bar ("3 of 8 flagged").

## Progress (A3 with B2's bar)

```
┌ Progress ─────────────────────────────────────────────────────────── Last pulled 2 h ago  [Pull] ┐
│ 137 of 160 done, 36 of them approved                                                              │
│ [██████ Approved 36 ██████|░░░░░░░░░ not decided yet 101 ░░░░░░░░░|      to go 23      ]  Not approved 10, not counted │
│ 23 to go · 10 a day over the last 7 days · about 2 days at this pace                              │
│ [By district] [By district and settlement]                                                        │
│ District │ Target │ Done │ Approved │ Progress            │ Last 7 days │ To go │ Not approved     │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The "Approved submissions only" switch goes: both numbers are always on the bar.

## States (D1)

With checks off, which is how new surveys start, the pages say what did not run: "2 of 10 checks are on" beside
Flagged; "No checks are on, so nothing has been flagged" instead of "No issues found"; "not measured" with a link to
the setting when there are no don't-know codes or no start and end questions; under 5 submissions an enumerator is
listed apart and not highlighted.

## Build order

1. **One calculation, one set of names.** `services/metrics.py` and `etl/duration.py`; Field team, Data quality,
   Progress and the pull summary read from them and use the named counts. Fixes F-10 A.
2. **Field team table and call sheet.** `/api/performance` adds per-check counts, the middle half of durations,
   first and last submission, a daily trend (all in the shared summary, for Data quality to use next), each
   enumerator's durations, which checks are on, and a period.
3. **Data quality Overview and By check.** `/api/quality/overview` adds a row per check (flagged, Needs review, the
   last 14 days, the enumerator it flags most, on or off), when the oldest submission in Needs review was sent, and
   which checks are on; the issue frequency and issue time series it replaces are gone. The tiles, review bar, period
   menu and daily chart are shared with Field team.
4. Progress bar.
5. Data quality By question.

Not covered, and not needed for now: exports and a cleaning log (Kobo exports; the edit history could feed a cleaning
log later), back-checks, a daily objective per enumerator.

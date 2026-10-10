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
- **Issues per submission:** issues ÷ submissions, every submission counting once. Most useful as a trend: weekly on
  Data quality, per enumerator on the call sheet. Flagged share is the headline.
- **Highlighting is driven by flags, against the team:** a cell is highlighted when an enumerator's share flagged by a
  check, or their Not approved share, is at least twice the team's. Duration and don't-know rate are shown plain;
  the checks carry the verdict. With checks off, nothing is highlighted.
- **Not approved is a major signal:** its own column on Field team, first on the call sheet.
- **Default period: the whole survey.**
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
┌ Field team ─────────────────────────────────── Period [Whole survey ▾]   Last pulled 2 h ago  [Pull] ┐
│ ┌ Flagged 45% ┐ ┌ Duration 27 min ┐ ┌ Don't-know 2.6% ┐ ┌ Checks on 8 of 10 ┐ ┌ Reviewed 32% (grey) ┐ │
│ 4 submissions have no enumerator recorded. They count in the team's figures, not as an enumerator.   │
│ Who to follow up with                                                   [Find an enumerator ID]       │
│ Enumerator │ Subs │ Flagged      │ Not approved │ Main issue               │ Duration │ DK  │ Reviewed │NR │
│ Whole team │ 147  │ 46%          │ 7%           │ Interview too short ×38  │ 27 min   │2.6% │ 46 of 147│42→│
│ enum_07    │ 32   │ ▇▇▇▇ [100%]  │ [25%]        │ [Interview too short ×32]│ 6 min    │5.9% │ 9 of 32  │20→│
│ enum_03    │ 22   │ ▇▇ 41%       │ 5%           │ Outside office hours ×6  │ 29 min   │0.4% │ 6 of 22  │ 6→│
│ … Too few submissions to compare (under 5): enum_08                                                  │
│ No enumerator recorded │ 4 │ 50% │ 0% │ …   (last, never sorted among the enumerators or highlighted)   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
[ ] = highlighted: at least twice the team's share. Columns sort from their heading. A row opens the call sheet;
the Needs review count (NR) opens that enumerator's Needs review.
```

**Main issue** is the check that flagged most of their submissions, with one at twice the team's share first, so the
column names what to talk about, not what everyone gets. "Checks on" names the checks that are off; with none on, a
line says nothing has been flagged and that this doesn't mean the data is clean. A period with no submissions says so.

The call sheet (C1) has its own address, `/surveys/<id>/team/<enumerator>`, opens beside a compact list of the team,
and Back returns to the table. In order: Not approved and Flagged against the team; duration, their interviews as
dots over the team's middle half and median; the don't-know rate against the team; the checks that flagged them, each
with its share against the team's and a link to those submissions; their submissions in review (Needs review, On
hold, Clean, Approved, Not approved); issues per submission by week, theirs and the team's; and a plain summary to
copy into a message or read on the call. Buttons open their Needs review and all their submissions.

Removed: the five summary cards, the ranking card, the submissions bar chart and the scatter.

## Data quality (A2, E1)

- **Overview:** the review bar (Needs review, On hold, Clean, Approved, Not approved, each opening its tab), the oldest
  submission still waiting; Flagged, Duration, Don't-know rate, Checks on; issues per submission by week; submissions
  by the day collected, coloured by where they stand now.
- **By check:** each check that is on, with submissions flagged, share, the last 14 days, the enumerator with the most,
  and its Needs review count; checks that are off are listed as off, with a link to turn them on.
- **By question (E1):** every question, the ones to look at first on top.

| Column | Rule | Looked at when |
|---|---|---|
| Asked in | Share of submissions the question was shown in, from its condition and its group's (`etl/relevance.py` evaluates them, as the blank check does); the condition beside it. Where a condition can't be evaluated, the share answered, said as such. | Under 10% with a condition ("Rarely asked"); 0% with a Form check finding ("Can never be shown"). |
| Don't-know | Don't-know answers out of answers, for questions that allow one; how many enumerators record it. | 20% or more. Spread across the team points at the wording; one enumerator, at them. |
| "Other" | Share choosing Other. | 20% or more: the list may be missing an option. |
| Flagged | Outlier and AI review findings on the question. | |
| Corrected | Submissions where the answer was edited in Kobo (edit history, since #94). | 3 or more. |

Time per question needs the audit processor to keep per-question times (`etl/audit_processor.py` keeps totals); later.

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
   first and last submission, a weekly trend (all in the shared summary, for Data quality to use next), each
   enumerator's durations, which checks are on, and a period.
3. Data quality Overview and By check.
4. Progress bar.
5. Data quality By question.

Not covered, and not needed for now: exports and a cleaning log (Kobo exports; the edit history could feed a cleaning
log later), back-checks, a daily objective per enumerator.

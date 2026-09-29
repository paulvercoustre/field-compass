# W2 — Field Team: separate data quality from review progress (F-08, F-11)

Today every enumerator metric that says "Validated", "approval rate" or "Top performer" is computed from
`qa_status == APPROVED` (`backend/routers/progress.py:580`) — i.e. how many of that person's submissions a
reviewer has already approved in Kobo. The on-screen definition says "surveys with no issues found"
(`PerformanceDataView.tsx:13`). With 67 % of submissions not yet reviewed, every bar is red and the
enumerator with 6-minute interviews ranks #3 "Top performer" (screenshot `j6-01-field-team.png`).

## Proposed layout

```
┌ Field team ─────────────────────────────── Period: [Last 7 days ▾]   Last pulled 14:32 ┐
│ ┌ Enumerators 8 ┐ ┌ Flag rate (team) 46% ┐ ┌ Reviewed 34% of submissions ┐ ┌ No enumerator recorded 4 ┐ │
│ └───────────────┘ └──────────────────────┘ └──────────────────────────────┘ └ (view submissions →) ──────┘ │
│                                                                                                 │
│ Who to follow up with            sorted by: [Flag rate ▾]                                       │
│ ┌──────────────────────┬──────┬───────────┬───────────────┬──────────┬──────────┬────────────┐ │
│ │ Enumerator           │ Subs │ Flag rate │ Top issue     │ Median   │ DK rate  │ Reviewed   │ │
│ │                      │      │ (≥1 issue)│               │ active   │          │ (approved/ │ │
│ │                      │      │           │               │ minutes  │          │  total)    │ │
│ ├──────────────────────┼──────┼───────────┼───────────────┼──────────┼──────────┼────────────┤ │
│ │ Nadia Rahimi enum_07 │  32  │ ▇▇▇▇ 100% │ Too short (32)│ 6  ⚠     │ 5.9 %    │ 9 / 32     │ │
│ │ Grace Mensah enum_03 │  22  │ ▇▇  41%   │ Weekend (9)   │ 29       │ 0.0 %    │ 6 / 22     │ │
│ │ …                                                                                          │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Row → Submissions filtered to this enumerator, "Needs review" tab.   ⚠ = below team median by >50 % │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Metric | Definition (shown in the ⓘ, as a real `<button>`) | Source |
|---|---|---|
| Flag rate | Share of this enumerator's submissions with at least one quality issue, regardless of review status. | count `data_quality_issues` non-empty / total (new field in `/api/performance`, cheap: same loop at `progress.py:572`) |
| Top issue | Most frequent check for this enumerator, human label (F-12). | same loop |
| Reviewed | Approved / total — **a reviewer-progress number, not a quality score**. Shown last, grey, never colour-coded red/green. | existing `validated` |
| No enumerator recorded | Submissions where the enumerator question is blank. Not counted as an enumerator; links to them. | existing "Unknown" bucket, moved out of the table |

Names: show the choice **label** from the form ("Nadia Rahimi") with the code in small text, using the
existing `getChoiceLabel` (`utils/koboLabelUtils.ts`) the progress page already uses.

Remove "Top performer", medals and the leaderboard "Active time: longest = top" ranking
(`EnumeratorLeaderboard.tsx:49-51` comments "for simplicity… most thorough") — ranking people on a metric the
code itself calls context-dependent invites unfair conversations. Keep the scatter, but plot flag rate (y)
against submissions (x).

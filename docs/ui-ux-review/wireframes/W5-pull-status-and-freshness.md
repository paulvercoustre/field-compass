# W5 — Pulling from Kobo: status, freshness, failures (F-13, F-14, F-16)

## Header strip (one shared component on Submissions, Data Quality, Progress, Field team)

```
Last pulled from Kobo 14:32 · 12 min ago · 147 submissions            [ ↻ Pull new submissions ]
```
- "Last pulled" needs a persisted timestamp per survey (new column or reuse the latest ETL run record); today
  nothing is stored and "✓ Last run: 3.0s" (`Dashboard.tsx:266`) is the *duration* of a pull made in this page
  session.
- Viewers see the strip without the button (F-34).

## Outcomes (replace the four hand-built `ETL completed: …` strings)

| Situation (measured) | Today | Proposed banner |
|---|---|---|
| Normal pull | green "ETL completed: 147 fetched, 0 created, 147 updated, 147 checked, 43 flagged, 147 AI qualitative checks queued" | green `role=status`: "Pulled 147 submissions (0 new, 147 updated). 44 need review. AI checks running on 147 — results appear as they finish." |
| Kobo unreachable / wrong token (J3) | **green** "ETL completed: 0 fetched, 0 created…" after 3.5 s (`kobo_fetcher.py:140-142` swallows the error) | amber `role=alert`: "Couldn't reach Kobo (kf.kobotoolbox.org). Nothing was updated — your submissions below are from 14:32. [Try again] [Check connection]" |
| Some submissions failed to process (`errors > 0`, e.g. 146 in this review) | green, errors not shown | amber: "Pulled 147 submissions, but 146 couldn't be checked, so their flags may be missing. [Details]" |
| Viewer presses pull | red "ETL pipeline failed: 403: This action requires editor access or higher" and the **queue is replaced by the error** (`Dashboard.tsx:318`) | button not offered; if it happens anyway: "Only editors can pull new data." and the list stays |

"Flagged" in the banner must use the same definition as the queue's **Needs review** count (F-10); today the
banner said 43 while 67 submissions carried issues.

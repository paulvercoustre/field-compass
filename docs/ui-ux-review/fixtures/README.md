# Review fixtures — how to reproduce the observations

Everything here is synthetic and local. Nothing calls KoboToolbox or OpenAI.

| File | What it is |
|---|---|
| `mock_services.py` | One stdlib HTTP server on `127.0.0.1:8765`: a Kobo API v2 subset (`/api/v2/assets/…`, submissions, validation status, Enketo edit link, audit CSVs) and an OpenAI `chat.completions` subset (`/v1`). Serves a bilingual 18-question household form and 147 seeded submissions with planted problems (see the module docstring). |
| `run_stack.sh` | Starts the mock, Redis, a Celery worker, the FastAPI backend (:8000) and Vite (:3000) with throwaway keys (kept in `$LOGS/review-keys.env` so restarts can still decrypt stored tokens). |
| `build_findings.py` | Single source of the findings; writes `../findings.json` and the catalog pasted into `../REPORT.md` §7. |
| `journeys/*.js` | Playwright scripts used for J1–J9 and the measurements (see below). |

## 1. Database (disposable)

PostgreSQL 16 must not run as root, and needs a directory the `postgres` user can reach:

```bash
PGD=/var/tmp/fc-ui-review-pg
mkdir -p $PGD && chown postgres:postgres $PGD
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D $PGD/data -U postgres --auth=trust
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $PGD/data -o "-p 55432 -k $PGD -c listen_addresses=127.0.0.1" -l $PGD/pg.log start
psql -h 127.0.0.1 -p 55432 -U postgres -c "create database field_compass"
psql -h 127.0.0.1 -p 55432 -U postgres -d field_compass -f backend/database/schema.sql
(cd backend && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/field_compass alembic upgrade head)
```

## 2. Stack

```bash
python -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm install            # if cdn.sheetjs.com is unreachable: npm install --no-save xlsx@0.18.5 (+ the other deps)
VENV=$PWD/.venv LOGS=/tmp/fc-review-logs bash docs/ui-ux-review/fixtures/run_stack.sh
```

## 3. Accounts and data (through the UI, as in J1/J2)

1. Register `newuser@example.org` / `synthetic-pass-123`.
2. Account settings → Kobo API URL `http://127.0.0.1:8765/api/v2` → token `synthetic-token-not-real`. (Because of F-18 the URL only saves if you also edit Full name and press the Profile "Save Changes".)
3. New survey → link `https://kf.kobotoolbox.org/#/forms/aSynthHH2026Demo0000001` → Create → Refresh from Kobo.
4. To reproduce F-13's crash: enable AI qualitative checks on `main_challenge` while two don't-know codes are selected, then pull. To work around it, store `special_values.dk_string_value` as the single string `"dk"` via `PUT /api/surveys/{id}`.

## 4. Scripts

```bash
cd docs/ui-ux-review/fixtures/journeys
npm init -y && npm install playwright @axe-core/playwright axe-core
export REVIEW_OUT=/tmp/fc-review && mkdir -p $REVIEW_OUT
node j1.js    # first run (register + Kobo connection) — run once on a fresh DB
node j2.js    # create survey → first pull
node j8.js    # configure checks (includes the cross-section save leak test)
node j4.js    # review loop measurements
node j567.js  # Data Quality, Field Team, Progress   (j5.js = Data Quality only)
node j3.js    # stop mock_services.py first: pull while Kobo is unreachable
node j9.js    # sharing, viewer, expired session
node audit.js # axe + computed-style inventory on 13 screens
node kbd.js   # keyboard, dialogs, titles, reflow, zoom, dark mode
node tabcount.js; node reqs.js; node leads.js; node states.js; node detail.js
```

Screenshots are written to `../../screenshots/`, JSON results to `$REVIEW_OUT`. Set `CHROME_PATH` if Playwright should use a pre-installed Chromium.

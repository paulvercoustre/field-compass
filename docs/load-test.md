# Load test

How Field Compass holds up when the founding cohort works in it at once, and how to check it on the VM before they arrive.

The test plays reviewers doing what reviewers do, every 3 to 10 seconds: opening a survey's dashboard, working the review queue, opening submissions and their history, filtering, adding notes, with the app's activity check every minute. Meanwhile, pulls bring new and edited submissions into the surveys. The surveys and submissions are made up: nothing reaches Kobo, an AI provider or anyone's inbox.

- `backend/scripts/loadtest.py` makes the accounts and surveys on the server, pulls during the test, and cleans up.
- `loadtest/locustfile.py` is the reviewers, for [Locust](https://locust.io).

## What it found

### First round, on a 4-core test machine

With 15 surveys of 2,000 submissions and 3 reviewers per survey, the API answered like this:

| Reviewers at once | Before: typical / slowest 5% | After: typical / slowest 5% |
|---|---|---|
| 10 | 0.12 s / 0.45 s | 0.08 s / 0.26 s |
| 25 | 0.47 s / 1.3 s | 0.09 s / 0.39 s |
| 50 | 2.1 s / 3.5 s, some requests dropped | 0.20 s / 0.78 s, none dropped |

Before, the API topped out at 13 requests a second, and 50 active reviewers ask for about 26. Three things held it back:

1. **One request at a time.** Most routes were `async` but called the database without awaiting, so each one held the API's only event loop until it finished. They are now plain functions, which FastAPI runs in worker threads, and production runs one API process per CPU (`API_WORKERS`, 2 by default). The work is mostly Python, which threads can't run in parallel, so the processes are what doubled the capacity.
2. **A new database connection for every request.** The engine used `NullPool`, made for serverless hosting. Connections are now pooled, up to 30 per process. Each request's session is opened and closed on the event loop, so threads waiting for a connection can never block the one that would free it.
3. **Dropped connections.** uvicorn closed idle connections after 5 seconds, while Caddy reuses them for 2 minutes. A request could land on a connection being closed, which a person would see as a 502. The API now keeps idle connections 135 seconds.

With several processes, rate limits moved to Redis (`RATELIMIT_STORAGE_URI` in `docker-compose.prod.yml`); in memory, each process kept its own counts and every limit doubled.

### On the production VM, 24 October 2026

A Standard_D2as_v4 (2 CPUs, 8 GB), with the reviewers on a laptop in France:

| Reviewers at once | Requests a second | Typical | Slowest 5% | Failed |
|---|---|---|---|---|
| 10 | 5.7 | 0.12 s | 0.42 s | 0 |
| 25 | 12.1 | 0.27 s | 1.3 s | 0 |
| 50 | 14.3 | 1.5 s | 4.5 s | 1 of 4,283 |

Each reviewer asks for about 0.57 requests a second, so 50 ask for about 28: the VM gave 14 at most, all its 2 CPUs could work out (the same test on 2 CPUs of the test machine stopped at 19). It held about 25 reviewers working at once. The one failure was a note that got no answer for 118 seconds, then a dropped connection; the server's logs had no trace of it, so it was most likely the connection.

### Second round: the data pages

The slowest routes were the ones that read every submission of a survey on each request: the dashboard's progress, quality overview and Field team, the review queue and its filters, By question. Loading the submissions took most of their time. Two changes:

1. **Lighter reading** (`services/survey_rows.py`). These routes now load only the columns they use, as plain read-only rows rather than whole submissions, and JSON is read with orjson (`services/database.py`): a survey of 2,000 loads in 22 ms instead of 68. The queue loads in full only the page it shows.
2. **Answers kept until the survey changes** (`services/page_cache.py`). Progress, quality overview, Field team, the queue and its filters are kept in Redis for ten minutes, under a key made of the page and its filters, the survey's settings, and a fingerprint of its submissions and recordings: how many, and the sum of each row's `xmin`, the transaction that wrote it. A pull, an edit, a decision or a note writes a new row version, so the next request works its answer out afresh; nothing has to remember to clear anything. A kept answer comes back in 12 to 16 ms, as fast as opening a survey.

Responses are the same as before, checked on 309 requests across every tab, filter and sort, from the cache and without it.

On the test machine limited to 2 CPUs like the VM (API, Postgres, Redis and the pulls on two cores, the reviewers on the others), 50 reviewers:

| | Requests a second | Typical | Slowest 5% | Failed |
|---|---|---|---|---|
| Before | 18.8 | 0.81 s | 3.0 s | 0 |
| Lighter reading only (every answer worked out) | 27.3 | 0.13 s | 0.70 s | 0 |
| Both | 30.2 | 0.02 s | 0.21 s | 0 |

How much the kept answers help depends on how often a survey changes: in the test, each survey changed about every 30 seconds. A team deciding submission after submission changes it more often, and its pages fall back towards the middle row, which is still within the target below. A pull of a 2,000-submission survey with 60 new or edited submissions took 10 seconds meanwhile, 13 before.

The made-up submissions are small, about 300 characters of answers each. Real ones are often ten times that, which makes reading them slower and keeping the answers worth more.

### On the production VM again, 25 October 2026

With this round deployed, the same VM (2 CPUs, `API_WORKERS=2`), pulls running meanwhile, the reviewers on the same laptop:

| 50 reviewers | Requests a second | Typical | Slowest 5% | Slowest 1% | Failed |
|---|---|---|---|---|---|
| 24 October | 14.3 | 1.5 s | 4.5 s | 5.8 s | 1 of 4,283 |
| 25 October | 28.0 | 0.07 s | 0.36 s | 0.64 s | 0 of 8,390 |

The VM now gives the 28 requests a second 50 reviewers ask for, and every target below is met: 2 CPUs are enough for the founding cohort. The times include the laptop's trip to the VM in North Europe, about 40 ms, the fastest any request took.

## Running it on the VM

Do it at a quiet hour: the test uses the real server.

### 1. Make the accounts and surveys

On the VM:

```bash
cd ~/field-compass
C="docker compose -f docker-compose.prod.yml"
$C exec -T backend python -W ignore scripts/loadtest.py seed > loadtest.json
```

It makes 15 teams of 3 accounts on `loadtest.fieldcompass.invalid`, a domain that can't receive email. Each team shares a survey of 2,000 made-up submissions, and the script prints a 4-hour token per account. On the VM that took about 20 seconds per survey, 5 minutes in all. The tokens stop working 4 hours after the seed: check `made_at` in `loadtest.json` before a run.

Made-up submissions have IDs from 2,000,000,000 up, far above Kobo's; the script refuses to run if a real submission is in that range.

### 2. Run the reviewers

From a laptop, or Azure Cloud Shell (Python included), with the repository and `loadtest.json` copied from the VM (`scp azureuser@<VM>:~/field-compass/loadtest.json .`). Locust needs Python 3.10 or newer, with SSL: a Python that can't `import ssl` can't install it.

```bash
python -m venv .venv-locust && source .venv-locust/bin/activate
pip install locust==2.45.0
ulimit -n 10240   # macOS allows 256 open files by default
mkdir -p results
export LOADTEST_ACCOUNTS=loadtest.json
for users in 10 25 50; do
  locust -f loadtest/locustfile.py --host https://app.fieldcompass.org \
    --headless --users $users --spawn-rate 2 --run-time 5m --csv results/$users --only-summary
done
```

At the same time, on the VM, pulls into the test surveys:

```bash
$C exec -T backend python -W ignore scripts/loadtest.py pulls --minutes 20
```

And watch:

- `docker stats` on the VM: the CPU, the memory of `backend`, `worker` and `postgres`. 100% is one CPU, so a 2-CPU VM tops out at 200% in all;
- `https://app.fieldcompass.org/api/health` stays healthy;
- Sentry gets no new errors.

### 3. Read the results

Each run prints a table, and `results/<users>_stats.csv` has the same per route; `loadtest.json` and `results/` are kept out of git. The cohort is ready when, at 50 reviewers:

- the slowest 5% of requests (95%) answer in under 1.5 seconds;
- nothing fails;
- the VM's CPU isn't at its limit (200% on 2 CPUs) for minutes on end.

If the CPU is pinned, check the VM's size in Azure. A B-series VM (B2s, for example) runs on CPU credits: once they are spent under sustained load, it slows to a fraction of its CPU. A D-series VM doesn't.

More CPUs mean more API processes. From the current Standard_D2as_v4, resize to a **D4as_v4** (4 CPUs, 16 GB, the same family) or a D4as_v5. The v5 sizes have no local temporary disk (`/mnt`), which Azure allows for a Linux VM; check first that nothing is kept there, and no swap (`swapon --show`). The VM restarts: a few minutes' downtime. Then, in the VM's `.env`:

```bash
API_WORKERS=4   # one per CPU
```

and `docker compose -f docker-compose.prod.yml up -d backend`. Postgres accepts 200 connections, enough for 5 processes (each keeps up to 30); more processes than CPUs add memory and connections, not speed.

### 4. Clean up

On the VM:

```bash
$C exec -T backend python -W ignore scripts/loadtest.py cleanup
rm loadtest.json
```

It deletes every account on the load-test domain, with its surveys, submissions and the app's records of their activity. Delete `loadtest.json` on the machine that ran Locust too: its tokens work until they expire.

## What's next

- **Before the public launch**, run the test again at the size expected then: `seed --teams` sets how many teams, and Locust's `--users` how many reviewers. Past what 2 CPUs give, resize as described above.
- **By question** isn't kept: it reads the submissions' edit history too, and is opened less often. It loads its submissions the lighter way.
- **Surveys of 20,000 submissions or more.** Every route still reads a survey's submissions in Python each time its answer is worked out: that holds up at 2,000, and slows in proportion beyond. The next step there is to have the database count and page them.

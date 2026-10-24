# Load test

How Field Compass holds up when the founding cohort works in it at once, and how to check it on the VM before they arrive.

The test plays reviewers doing what reviewers do, every 3 to 10 seconds: opening a survey's dashboard, working the review queue, opening submissions and their history, filtering, adding notes, with the app's activity check every minute. Meanwhile, pulls bring new and edited submissions into the surveys. The surveys and submissions are made up: nothing reaches Kobo, an AI provider or anyone's inbox.

- `backend/scripts/loadtest.py` makes the accounts and surveys on the server, pulls during the test, and cleans up.
- `loadtest/locustfile.py` is the reviewers, for [Locust](https://locust.io).

## What it found

On a 4-core test machine with 15 surveys of 2,000 submissions and 3 reviewers per survey, the API answered like this:

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

A pull of a 2,000-submission survey with 60 new or edited submissions takes about 7 seconds; a survey's first pull of 2,000 about 90.

The production VM has fewer and slower CPUs than the test machine, so its numbers will be higher. The run below measures them.

## Running it on the VM

Do it at a quiet hour: the test uses the real server, and the seed takes a while. It needs this change deployed (2 API processes).

### 1. Make the accounts and surveys

On the VM:

```bash
cd ~/field-compass
C="docker compose -f docker-compose.prod.yml"
$C exec -T backend python -W ignore scripts/loadtest.py seed > loadtest.json
```

It makes 15 teams of 3 accounts on `loadtest.fieldcompass.invalid`, a domain that can't receive email. Each team shares a survey of 2,000 made-up submissions, and the script prints a 4-hour token per account. Locally that took 90 seconds per survey; on the VM count about an hour. `--submissions 1000` halves it.

Made-up submissions have IDs from 2,000,000,000 up, far above Kobo's; the script refuses to run if a real submission is in that range.

### 2. Run the reviewers

From a laptop, or Azure Cloud Shell (Python included), with the repository and `loadtest.json` copied from the VM:

```bash
pip install locust==2.45.0
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

- `docker stats` on the VM: the CPU, the memory of `backend`, `worker` and `postgres`;
- `https://app.fieldcompass.org/api/health` stays healthy;
- Sentry gets no new errors.

### 3. Read the results

Each run prints a table, and `results/<users>_stats.csv` has the same per route. The cohort is ready when, at 50 reviewers:

- the slowest 5% of requests (95%) answer in under 1.5 seconds;
- nothing fails;
- the VM's CPU isn't pinned at 100% for minutes on end.

If the CPU is pinned, check the VM's size in Azure. A B-series VM (B2s, for example) runs on CPU credits: once they are spent under sustained load, it slows to a fraction of its CPU. A D-series VM with the same number of CPUs (D2as_v5, for example) doesn't. With more CPUs, raise `API_WORKERS` to match.

### 4. Clean up

On the VM:

```bash
$C exec -T backend python -W ignore scripts/loadtest.py cleanup
rm loadtest.json
```

It deletes every account on the load-test domain, with its surveys, submissions and the app's records of their activity. Delete `loadtest.json` on the machine that ran Locust too: its tokens work until they expire.

## What's next

The slowest routes are the review queue (`/api/submissions`), the dashboard's progress and quality overview: each reads all of a survey's submissions in Python on every request. They hold up at 2,000 submissions per survey. For surveys of 20,000 or more, the next step is to have the database count and page them.

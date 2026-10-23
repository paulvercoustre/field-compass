# Monitoring

Three things tell you when Field Compass is in trouble, before its users do:

| What | Watches | Tells you |
|---|---|---|
| An uptime monitor on `/api/health` | The site, the database, Redis, the scheduled tasks, the VM's disk | Within minutes of an outage |
| Sentry | Server errors, failed background tasks, anything logged as an error | When a new kind of error appears, or errors spike |
| A heartbeat for the nightly backup | That the backup ran and succeeded | The morning after it didn't |

Only Sentry receives personal data, and little of it: it is on the sub-processor list in [`site/privacy/`](../site/privacy/index.html). The uptime monitor and the heartbeat service see a status page and a ping, nothing about anyone.

## The uptime monitor

`GET /api/health` answers 200 when all is well and **503** when something is down, with what:

```json
{"status": "healthy", "database": "connected", "redis": "connected", "scheduled_tasks": "ok", "disk": "41% used"}
```

- `scheduled_tasks` is `stalled` when the five-minute sweep hasn't run for 15 minutes: the worker or its scheduler has stopped, and with it pulls, AI reviews and transcriptions. Just after a restart it says `starting` for up to 15 minutes, which counts as healthy.
- `disk` fails at 90% used. On one VM a full disk is what usually stops everything: Postgres can no longer write.

`/health` checks less, the API and its database, because the deploy script and CI wait on it with no worker running. Point the monitor at `/api/health`.

Set it up in a hosted monitor, such as UptimeRobot or Better Stack (both have free plans):

1. An HTTP monitor on `https://app.fieldcompass.org/api/health`, every 1 to 5 minutes, alerting on any status other than 200.
2. Alert after 2 failed checks in a row, from more than one location if the plan allows: one blip is not an outage.
3. Alerts by push notification or SMS to your phone, and by email.
4. Also turn on its certificate-expiry alert, 14 days ahead. Caddy renews the certificate itself; this catches it when it can't.

## Errors: Sentry

The API and the worker send their errors to Sentry when `SENTRY_DSN` is set (`backend/services/monitoring.py`). What is sent is kept to the error and where it happened:

- no request bodies, headers, cookies or query strings, and no local variables from the stack;
- email addresses, IP addresses, the values database errors quote, and invitation tokens are blanked out of everything else;
- no user. The log lines just before an error ride along and can include user IDs, never names or addresses: the code's rule is that logs never name people.

Server errors (5xx), failed background tasks and anything logged as an error are reported, except 503: the API answers it when a feature isn't set up or a provider is unavailable, and says so to the person. There is no performance tracing.

### One-time setup

1. Sign up at sentry.io with an address Fieldcompass.org keeps, such as `tech@fieldcompass.org`. When it asks for the **data storage location, choose the EU (Germany)**. It can't be changed afterwards, and the privacy notice says the EU.
2. **Settings → Legal & Compliance**: accept Sentry's data processing addendum and keep a copy with the other sub-processors' agreements. Check the company it names: the privacy notice says **Functional Software, Inc.** Check the retention on your plan too: the privacy notice says up to 90 days.
3. Turn on two-factor authentication for the account.
4. Create a project, platform **FastAPI**, named `field-compass`. Copy its **DSN**.
5. In the project, **Settings → Security & Privacy**: turn on **Data Scrubber**, **Use Default Scrubbers** and **Prevent Storing of IP Addresses**. They are Sentry's own defences, on top of the app's.
6. **Alerts**: keep the default alert for new issues, by email. Add one for a spike, for example more than 50 events in 5 minutes, and install Sentry's phone app to get it as a push notification.
7. In the VM's `.env`:

   ```bash
   SENTRY_DSN=https://<key>@<org>.ingest.de.sentry.io/<project>
   ```

   Then recreate the API and the worker:

   ```bash
   docker compose -f docker-compose.prod.yml up -d backend worker
   ```

8. Check it: send a test event, and look for it in Sentry under the project's issues.

   ```bash
   docker compose -f docker-compose.prod.yml exec backend python -c "
   import sentry_sdk
   from services.monitoring import init_sentry
   init_sentry('api'); sentry_sdk.capture_message('Field Compass: test event'); sentry_sdk.flush()"
   ```

Each event carries the release, the deployed image's tag (`sha-<commit>`), so Sentry can tell which deploy introduced an error. `SENTRY_ENVIRONMENT` overrides the environment name, `ENVIRONMENT` by default.

## The backup's heartbeat

The nightly backup (`deploy/backup/backup.sh`, see [backups.md](backups.md)) pings `BACKUP_HEARTBEAT_URL` once it has succeeded. A heartbeat service alerts when the ping doesn't arrive, which catches a backup that fails, or stops running, silently.

1. In Healthchecks.io (free) or your uptime monitor's heartbeat feature, add a check named "Field Compass backup": period 1 day, grace 2 hours.
2. Put its ping URL in the VM's `.env` as `BACKUP_HEARTBEAT_URL`, then recreate the backup service:

   ```bash
   docker compose -f docker-compose.prod.yml up -d backup
   ```

3. The next morning, check that the first ping arrived.

## Test the alerts once

An alert never seen firing is an assumption. Once everything is set up:

- at a quiet hour, stop the worker for 20 minutes (`docker compose -f docker-compose.prod.yml stop worker`, then `start worker`): the uptime monitor should alert that `scheduled_tasks` is `stalled`, and recover;
- the test event above shows Sentry's side.

Then prune: an alert that fires and gets ignored teaches you to ignore alerts. Loosen or remove it.

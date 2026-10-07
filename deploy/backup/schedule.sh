#!/bin/sh
#
# Runs backup.sh once a day, at or after BACKUP_HOUR (UTC).
#
# Checks every 10 minutes whether today's backup is done, rather than sleeping
# until a set time: a container restarted by a deploy, or a VM that was off at
# the scheduled hour, catches up on its next check instead of skipping the day.
# A failed backup is retried an hour later.
set -u

HOUR="${BACKUP_HOUR:-2}"
LOCAL_DIR="${BACKUP_DIR:-/backups}"

echo "[backup] scheduler started: daily at ${HOUR}:00 UTC or later, local copies in ${LOCAL_DIR}"
while :; do
  today="$(date -u +%Y-%m-%d)"
  last="$(cat "${LOCAL_DIR}/.last_success_day" 2>/dev/null || true)"
  if [ "$last" != "$today" ] && [ "$(date -u +%H | sed 's/^0//')" -ge "$HOUR" ]; then
    if backup.sh; then
      echo "$today" > "${LOCAL_DIR}/.last_success_day"
    else
      # Retry, but not every 10 minutes: an expired upload key would otherwise
      # dump the database 144 times a day until someone notices.
      sleep 3000
    fi
  fi
  sleep 600
done

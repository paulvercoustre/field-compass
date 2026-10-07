# Database backups. The base image must match the postgres service's major
# version in docker-compose.prod.yml: pg_dump refuses a newer server.
FROM postgres:15-alpine

RUN apk add --no-cache curl

COPY backup.sh schedule.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/schedule.sh

# Unhealthy when the last good backup is more than 26 hours old, so
# `docker compose ps` shows a backup that has stopped working.
HEALTHCHECK --interval=30m --timeout=10s --start-period=26h \
  CMD test $(( $(date -u +%s) - $(cat /backups/.last_success 2>/dev/null || echo 0) )) -lt 93600

CMD ["schedule.sh"]

#!/bin/sh
#
# One database backup: pg_dump to a local file, then (when configured) an
# upload off the VM. Run on a schedule by schedule.sh; run it by hand with
#   docker compose -f docker-compose.prod.yml exec backup backup.sh
#
# Every backup is a new file named after the time it was taken, so one never
# replaces another. The upload key only allows creating files: it cannot
# overwrite or delete, so a mistake or an intruder on the VM cannot destroy the
# copies already made. Old copies are removed by the storage's own expiry
# rules, not from here. See docs/backups.md.
set -eu

LOCAL_DIR="${BACKUP_DIR:-/backups}"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-3}"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
fail() { log "BACKUP FAILED: $*"; exit 1; }

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
name="field_compass-${stamp}.dump"
partial="${LOCAL_DIR}/.${name}.partial"

# Custom format: compressed, and pg_restore can bring back one table from it.
log "dumping ${PGDATABASE} to ${name}"
pg_dump --format=custom --no-owner --file="$partial" \
  || { rm -f "$partial"; fail "pg_dump exited non-zero"; }
mv "$partial" "${LOCAL_DIR}/${name}"
size="$(wc -c < "${LOCAL_DIR}/${name}" | tr -d ' ')"
log "dump ok, ${size} bytes"

# A few recent copies stay on the VM for a quick restore. They are not a backup
# on their own: they go down with the VM's disk.
ls -1t "${LOCAL_DIR}"/field_compass-*.dump 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do
  rm -f "$old"
done

upload() {
  # BACKUP_UPLOAD_URL is a container URL with a SAS token:
  #   https://<account>.blob.core.windows.net/<container>?<sas>
  base="${BACKUP_UPLOAD_URL%%\?*}"
  sas="${BACKUP_UPLOAD_URL#*\?}"
  [ "$sas" != "$BACKUP_UPLOAD_URL" ] || fail "BACKUP_UPLOAD_URL has no ?<sas token> part"
  curl --fail --silent --show-error --retry 3 --retry-delay 10 \
    -X PUT -H "x-ms-blob-type: BlockBlob" -H "Content-Type: application/octet-stream" \
    --upload-file "${LOCAL_DIR}/${name}" "${base}/$1/${name}?${sas}" >/dev/null \
    || fail "upload to $1/ failed"
  log "uploaded to $1/${name}"
}

if [ -z "${BACKUP_UPLOAD_URL:-}" ]; then
  log "WARNING: BACKUP_UPLOAD_URL is not set, so this copy is on the VM only"
else
  upload daily
  # Sundays are kept longer, under their own prefix with its own expiry rule.
  [ "$(date -u +%u)" = 7 ] && upload weekly
fi

date -u +%s > "${LOCAL_DIR}/.last_success"
log "done"

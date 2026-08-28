#!/usr/bin/env bash
#
# Field Compass production deploy, invoked over SSH by the CI deploy key.
#
# Installed on the VM at /usr/local/bin/field-compass-deploy and pinned as the
# forced command for the CI key in ~/.ssh/authorized_keys, so that key cannot
# open a shell or run anything else -- if it leaks, it can only deploy.
#
# The only thing the caller controls is SSH_ORIGINAL_COMMAND, which must be the
# commit SHA to deploy. Deploying an explicit SHA (rather than whatever main
# points at now) pins production to exactly the commit CI tested, even if main
# has moved on while the pipeline was running.
#
set -euo pipefail

REPO_DIR="${FIELD_COMPASS_DIR:-/home/azureuser/field-compass}"
COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://localhost/health"
HEALTH_RETRIES=45
HEALTH_DELAY=2

log()  { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# Never eval or interpolate this into a command -- validate it is a bare SHA.
TARGET_SHA="${SSH_ORIGINAL_COMMAND:-}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail "expected a 40-character commit SHA, got: '${TARGET_SHA}'"

cd "$REPO_DIR" || fail "repo not found at ${REPO_DIR}"

# A dirty tree would make the checkout below fail halfway through, leaving the
# VM on neither the old nor the new commit. Refuse up front instead.
if ! git diff --quiet HEAD 2>/dev/null; then
  fail "working tree at ${REPO_DIR} has uncommitted changes -- refusing to deploy over them"
fi

PREVIOUS_SHA="$(git rev-parse HEAD)"
log "currently deployed: ${PREVIOUS_SHA}"
log "deploying:          ${TARGET_SHA}"

health_ok() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"healthy"'; then
      log "health check passed after $(( i * HEALTH_DELAY ))s"
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

bring_up() {
  git -c advice.detachedHead=false checkout --quiet "$1"
  # --build is required, not optional: VITE_API_URL is baked into the frontend
  # bundle at build time, so a plain restart would ship the previous bundle.
  docker compose -f "$COMPOSE_FILE" up -d --build
}

log "fetching from origin"
git fetch --quiet origin main
git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null \
  || fail "commit ${TARGET_SHA} not found after fetch -- was it pushed to origin?"

bring_up "$TARGET_SHA"

if health_ok; then
  log "DEPLOY OK ${TARGET_SHA}"
  exit 0
fi

log "health check FAILED after $(( HEALTH_RETRIES * HEALTH_DELAY ))s"
log "=== container state ==="
docker compose -f "$COMPOSE_FILE" ps || true
log "=== recent logs ==="
docker compose -f "$COMPOSE_FILE" logs --tail 50 || true

if [ "$PREVIOUS_SHA" = "$TARGET_SHA" ]; then
  fail "deploy failed health check and there is nothing to roll back to"
fi

log "rolling back to ${PREVIOUS_SHA}"
bring_up "$PREVIOUS_SHA"

if health_ok; then
  fail "deploy of ${TARGET_SHA} failed its health check; rolled back to ${PREVIOUS_SHA} and the site is up"
else
  fail "deploy of ${TARGET_SHA} failed AND rollback to ${PREVIOUS_SHA} is also unhealthy -- the site is DOWN, manual intervention needed"
fi

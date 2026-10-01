#!/usr/bin/env bash
# Start the local review stack: mock Kobo/OpenAI, FastAPI backend, Vite frontend.
# Assumes a disposable Postgres on 127.0.0.1:55432 with db field_compass already
# migrated (see README.md in this folder). All keys are throwaway, generated here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VENV="${VENV:-$ROOT/.venv}"
LOGS="${LOGS:-/tmp/fc-review-logs}"
mkdir -p "$LOGS"

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/field_compass"
# Throwaway keys, generated once per review environment and reused on restart
# (a new ENCRYPTION_KEY would make stored Kobo tokens undecryptable).
KEYS="$LOGS/review-keys.env"
if [ ! -f "$KEYS" ]; then
  {
    echo "JWT_SECRET_KEY=review-only-$(date +%s)"
    echo "ENCRYPTION_KEY=$("$VENV/bin/python" -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())')"
  } > "$KEYS"
fi
set -a; . "$KEYS"; set +a
export OPENAI_API_KEY="sk-mock-not-a-real-key"
export OPENAI_BASE_URL="http://127.0.0.1:8765/v1"
export OPENAI_MODEL="gpt-4o-mini"
export CELERY_BROKER_URL="redis://127.0.0.1:6379/0"
export CELERY_RESULT_BACKEND="redis://127.0.0.1:6379/0"
export AUDIT_DIR="$LOGS/audits"
export ENVIRONMENT=development
export NO_PROXY="localhost,127.0.0.1"

"$VENV/bin/python" "$ROOT/docs/ui-ux-review/fixtures/mock_services.py" > "$LOGS/mock.log" 2>&1 &
redis-server --port 6379 --bind 127.0.0.1 --save "" > "$LOGS/redis.log" 2>&1 &
( cd "$ROOT/backend" && PYTHONPATH="$ROOT/backend" "$VENV/bin/celery" -A services.job_queue.celery_app worker -Q qualitative_checks,default --concurrency 2 --loglevel INFO > "$LOGS/worker.log" 2>&1 ) &
( cd "$ROOT/backend" && "$VENV/bin/uvicorn" main:app --host 127.0.0.1 --port 8000 > "$LOGS/backend.log" 2>&1 ) &
( cd "$ROOT" && VITE_API_URL="http://localhost:8000" npx vite --port 3000 --host 127.0.0.1 > "$LOGS/vite.log" 2>&1 ) &
echo "mock:8765 backend:8000 frontend:3000 (logs in $LOGS)"
wait

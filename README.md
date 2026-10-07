# Field Compass

Data quality checks for KoboToolbox surveys, run while data collection is still under way.

Field Compass pulls submissions from a Kobo project, checks each one against the rules you set, and gives supervisors a review queue. Problems surface while the field team can still go back to the household, not after fieldwork ends.

- **Quality checks:** collection period, weekends, office hours, interview duration, outliers, "Don't know" and empty-answer rates, and collection targets. Custom checks can be written by hand or drafted by AI from the form.
- **AI review of open-text answers:** flags answers that are unreadable, off-topic or too vague.
- **Audio transcription and translation:** recordings are transcribed (ElevenLabs) and answers translated. Both can be sent back to Kobo.
- **Form readiness check:** finds form issues that would switch quality checks off before fieldwork starts.
- **Review and follow-up:** approve or flag submissions (synced to Kobo's validation status), see progress against targets, and follow each enumerator's results.
- **Teams:** surveys are shared with editors and viewers. AI features run on each owner's own API key, or on a monthly allowance included per user.

## Architecture

| Part | Stack | Where |
|---|---|---|
| Web app | React 19, TypeScript, Vite, Tailwind | `frontend/` |
| API | FastAPI, SQLAlchemy 2, Pydantic 2 | `backend/` |
| Background jobs | Celery workers on Redis: pulls, AI review, transcription, translation, Kobo sync | `backend/services/` |
| Database | PostgreSQL, migrated with Alembic | `backend/alembic/` |
| Production | Docker Compose on one VM behind Caddy, deployed from CI | `docker-compose.prod.yml`, `deploy/` |

## Quick start

You need Docker and Node.js 22.

```bash
cp .env.example .env
```

Then, in `.env`, replace the two placeholder secrets. The API won't start with them. Generate the values with:

```bash
openssl rand -hex 32                     # JWT_SECRET_KEY
openssl rand -base64 32 | tr '+/' '-_'   # ENCRYPTION_KEY (a Fernet key)
```

Start the API, worker, database and Redis, then the web app:

```bash
docker compose up -d          # or: make up
npm install
npm run dev
```

Open http://localhost:3000 and register. Then, under **Account settings → Kobo connection**, connect your Kobo account, create a survey from a Kobo project link, and pull its submissions. The API docs are at http://localhost:8000/docs.

Migrations run on their own: the `migrate` service runs `alembic upgrade head` before the API and worker start.

## Configuration

Every setting is an environment variable, read in one place: [`backend/settings.py`](backend/settings.py), with defaults and validation. [`.env.example`](.env.example) lists them all with notes. A malformed value stops the API and worker on startup, with a message that names the variable.

The ones you're most likely to set:

| Variable | What it does |
|---|---|
| `JWT_SECRET_KEY`, `ENCRYPTION_KEY` | Sign logins and encrypt stored API keys. Required. |
| `OPENAI_API_KEY` | Your own key for the included AI usage. Without it, each survey owner adds their own key. |
| `ELEVENLABS_API_KEY` | The same, for transcription. |
| `AI_ALLOWANCE_*`, `TRANSCRIPTION_ALLOWANCE_*` | Included usage per user per month. |
| `CORS_ORIGINS`, `SITE_ADDRESS` | Production origin and domain. |

## Development

```bash
# Backend (from backend/)
pip install -r requirements.txt
ruff check . && ruff format --check .
pyright
DATABASE_URL=sqlite:///:memory: pytest

# Frontend (from the repository root)
npx tsc --noEmit
npx knip               # unused files, exports and dependencies
npm test
npm run format         # Prettier; CI runs format:check
```

CI runs all of these on every push. To change the schema, edit the models in `backend/database/models.py` and add a revision with `alembic revision -m "..."` in `backend/alembic/versions/`.

[DEVELOPMENT.md](DEVELOPMENT.md) covers running the backend outside Docker, and Docker troubleshooting.

## Deployment

Pushes to `main` are tested and the backend image is published to GHCR. Then CI deploys that exact commit to the VM over SSH, using [`deploy/vm/deploy.sh`](deploy/vm/deploy.sh). If the health check fails afterwards, the script rolls back, schema included. The database is backed up every night, off the VM: see [docs/backups.md](docs/backups.md).

To set up the VM, follow [VM_DEPLOYMENT_AZURE.md](VM_DEPLOYMENT_AZURE.md). [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) lists what to check before a release.

## Further reading

- [`docs/specs/`](docs/specs): design notes for the AI providers and allowances, transcription, translation and the quality dashboard
- [`docs/code-quality-review.md`](docs/code-quality-review.md): the codebase review and what came of it

## License

[MIT](LICENSE)

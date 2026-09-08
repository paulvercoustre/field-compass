# Database Schema

This directory contains the PostgreSQL database schema for Field Compass.

## Files

- `schema.sql` - Complete database schema with all tables, indexes, and triggers.
  Builds a **brand-new** database only: Postgres runs
  `/docker-entrypoint-initdb.d` exclusively on an empty data directory.
- `migrations/` - The historical `.sql` scripts.
  `006_sync_schema_with_models.sql` is still live: it is the Alembic baseline.
- `../alembic/` - Alembic, which changes the shape of databases that already
  exist. This is where new migrations go.

## Changing the schema

Anything that alters an existing database is an Alembic revision. Editing
`schema.sql` alone changes nothing for any database that already exists --
including production, and including your own local one after the first
`docker compose up`. That mistake is why the `users` table was missing in
production while every test passed.

A schema change is therefore usually **two** edits: the ORM model in
`models.py`, and a revision. Keep `schema.sql` current as well -- it is what a
fresh database is built from, and `tests/test_schema_parity.py` fails if it
drifts from the models.

```bash
# From backend/. DATABASE_URL must point at the database you mean to change;
# alembic will not guess one.
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/field_compass

alembic revision -m "add whatever column"     # writes a file to alembic/versions/
alembic upgrade head                          # apply it
alembic current                               # where this database stands
alembic history                               # the chain
```

`--autogenerate` will draft the revision by diffing the models against a live
database, but read what it produces: it does not see CHECK constraints, partial
indexes, triggers or functions, and this schema uses all four.

To see what a migration would do to production without doing it:

```bash
alembic upgrade head --sql
```

### How this reaches production

The `migrate` service in `docker-compose.prod.yml` runs `alembic upgrade head`
from the backend image on every deploy, before the API starts. A failure exits
non-zero and the API never starts, because backend and worker wait on
`service_completed_successfully`.

### The baseline

Revision `0001_baseline` executes `migrations/006_sync_schema_with_models.sql`,
which is idempotent. Every database reaches Alembic through it: a fresh one
built from `schema.sql`, production, or something older still running
somewhere. Nothing inspects a database and guesses whether it "looks migrated"
-- getting that wrong on real submissions is not recoverable.

One consequence: 006 must keep covering every column the ORM defines, and
`tests/test_schema_parity.py` enforces that. Revisions from 0002 onward are
ordinary immutable Alembic revisions carrying their own SQL.

## Database Structure

### Tables

1. **survey_configs** - Survey-specific configuration settings
2. **validation_rules** - High-frequency check (HFC) validation rules
3. **submissions_current** - Current state of all survey submissions
4. **submissions_history** - Audit log of submission edits

## Setup Instructions

### Prerequisites

- PostgreSQL 12+ (with JSONB support)
- Database user with CREATE privileges

### Creating the Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE field_compass;

# Connect to the database
\c field_compass

# Run the schema
\i backend/database/schema.sql
```

### Using Docker

```bash
# Start PostgreSQL container
docker run -d \
  --name field-compass-db \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=field_compass \
  -p 5432:5432 \
  postgres:15

# Run schema
psql -h localhost -U postgres -d field_compass -f backend/database/schema.sql
```

## Schema Details

### survey_configs

Stores configuration for each survey, including:
- Core identifier variable names (UUID, enumerator, dates, etc.)
- Sampling frame configuration
- Special values (DK values)
- PII columns
- Roster processing settings
- Global parameters (date ranges, duration limits)

### validation_rules

Stores validation rules for high-frequency checks:
- Rule name and description
- Variables involved
- Check expression (logical condition)
- Roster association (if applicable)
- Active/inactive status

### submissions_current

Primary data store for submissions:
- Stable primary key: `_id` (from KoboToolbox)
- Complete submission data as JSONB
- Quality issues array
- QA status
- Edit flag

### submissions_history

Audit trail of all edits:
- Links to submission via `kobo_id`
- Stores JSON patch (diff) of changes
- Tracks deprecated UUIDs
- Timestamps all edits

## Indexes

The schema includes indexes for:
- Foreign key lookups
- Common query patterns (triage queue, filtering)
- JSONB field searches (GIN indexes)
- Performance optimization

## Notes

- All timestamps use `TIMESTAMP WITH TIME ZONE`
- JSONB is used throughout for flexibility
- Foreign keys ensure referential integrity
- Triggers automatically update `updated_at` columns


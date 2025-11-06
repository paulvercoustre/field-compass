# Database Schema

This directory contains the PostgreSQL database schema for Field Compass.

## Files

- `schema.sql` - Complete database schema with all tables, indexes, and triggers

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


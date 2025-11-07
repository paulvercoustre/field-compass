# ETL Package

This package contains the data ingestion and processing pipeline for Field Compass.

## Components

### 1. `kobo_fetcher.py` - KoboToolbox API Client

Fetches submissions and audit logs from the KoboToolbox API.

**Features:**
- Pagination support
- Rate limiting
- Error handling with retries
- Audit log download

**Usage:**
```python
from etl.kobo_fetcher import create_fetcher_from_env

fetcher = create_fetcher_from_env()
submissions = fetcher.get_asset_submissions(asset_uid="abc123", limit=1000)
```

**Environment Variables:**
- `KOBO_API_TOKEN`: Your KoboToolbox API token (required)
- `KOBO_API_URL`: Base URL for API (default: `https://kf.kobotoolbox.org/api/v2`)

### 2. `data_merger.py` - Data Merging and Edit Detection

Handles upsert logic with automatic edit detection and history tracking.

**Features:**
- Edit detection (300 second threshold)
- JSON patch diff calculation
- History tracking in `submissions_history` table
- Batch processing support

**Usage:**
```python
from etl.data_merger import parse_kobo_submission, merge_submission

parsed = parse_kobo_submission(kobo_data)
submission, history = merge_submission(db, parsed, survey_id)
```

### 3. `hfc_engine.py` - High-Frequency Check Engine

Performs data quality validation on submissions.

**Built-in Checks:**
- Missing UUID
- Missing enumerator ID
- Date range validation
- Weekend interview detection
- Survey duration checks (min/max)

**Custom Rules:**
- Loads validation rules from `validation_rules` table
- Supports custom check expressions
- Evaluates rules against submission data

**Usage:**
```python
from etl.hfc_engine import HFCEngine

engine = HFCEngine(db, survey_config)
issues = engine.run_checks(submission_data, submission_uuid)
qa_status = engine.determine_qa_status(issues)
```

### 4. `pipeline.py` - ETL Pipeline Orchestrator

Main orchestrator that combines all components.

**Usage:**
```python
from etl.pipeline import ETLPipeline

pipeline = ETLPipeline(db)
stats = pipeline.run_pipeline(
    survey_id="uuid-here",
    limit=1000,
    start_date=datetime(2023, 1, 1)
)
```

## Running the Pipeline

### Via CLI Script

```bash
python backend/scripts/run_etl.py <survey_id> [--limit N] [--start-date YYYY-MM-DD]
```

Example:
```bash
python backend/scripts/run_etl.py 123e4567-e89b-12d3-a456-426614174000 --limit 100
```

### Via API Endpoint

```bash
POST /api/etl/run/{survey_id}?limit=100&start_date=2023-01-01
```

## Pipeline Flow

1. **Fetch**: Retrieve submissions from KoboToolbox API
2. **Parse**: Convert Kobo format to internal format
3. **Merge**: Upsert submissions with edit detection
4. **Validate**: Run HFC checks
5. **Store**: Update database with results

## Configuration

Survey configuration is stored in the `survey_configs` table with the following structure:

```json
{
  "uuid": "_uuid",
  "enumerator": "enumerator_id",
  "date_interview": "today",
  "start_time": "start",
  "end_time": "end",
  "dk_value": -99,
  "dk_string_value": "dk",
  "data_collection_start_date": "2023-01-01",
  "data_collection_end_date": "2023-12-31",
  "min_survey_duration_minutes": 10,
  "max_survey_duration_minutes": 120
}
```

## Validation Rules

Validation rules are stored in the `validation_rules` table with the following structure:

```json
{
  "check_id": "outlier_age",
  "issue": "Age is an outlier",
  "check_expression": "age > 90",
  "variables_involved": ["age"],
  "roster_name": null
}
```

## Error Handling

The pipeline includes comprehensive error handling:
- Individual submission errors don't stop the pipeline
- Errors are logged and counted in statistics
- Database transactions are rolled back on errors

## Performance Considerations

- For large datasets (>10,000 submissions), consider using Airflow for scheduling
- The pipeline processes submissions sequentially (can be parallelized in future)
- Database commits are done per submission (can be batched for better performance)


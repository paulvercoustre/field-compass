# Testing the ETL Pipeline with Real KoboToolbox Data

This guide will help you test the ETL pipeline with real data from KoboToolbox.

## Prerequisites

1. **KoboToolbox API Token**
   - Go to: https://kf.kobotoolbox.org/token/
   - Copy your API token
   - Add it to your `.env` file:
     ```
     KOBO_API_TOKEN=your_token_here
     ```

2. **KoboToolbox Asset ID**
   - Go to your KoboToolbox project
   - The asset ID is in the URL: `https://kf.kobotoolbox.org/#/forms/ASSET_ID_HERE`
   - Or check the project settings

3. **Database Running**
   - Make sure PostgreSQL is running: `make up`
   - Verify connection: `make test-db` (if available)

## Step 1: Set Up Environment Variables

1. **Copy the example file** (if `.env` doesn't exist):
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and add your KoboToolbox API token**:
   ```bash
   # Database (for Docker Compose, use the default)
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/field_compass
   
   # KoboToolbox API (REQUIRED)
   # Get your token from: https://kf.kobotoolbox.org/token/
   KOBO_API_TOKEN=your_kobo_api_token_here
   KOBO_API_URL=https://kf.kobotoolbox.org/api/v2
   ```

3. **The Docker container will automatically load these variables** from the `.env` file when you run `make up` or `docker-compose up`.

**Note**: The `.env` file is in `.gitignore` and will not be committed to version control. This keeps your API token secure.

## Step 2: Create a Survey Configuration

You need to create a survey configuration in the database before running the ETL pipeline.

### Option A: Using the Helper Script

```bash
python backend/scripts/create_survey_config.py \
  --name "My Survey" \
  --asset-id "your_kobo_asset_id" \
  --use-defaults
```

This will create a survey with default configuration. You can customize it later.

### Option B: Using a Custom Config File

Create a JSON file with your survey configuration:

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
  "max_survey_duration_minutes": 120,
  "sampling_cols": ["district", "livelihood"]
}
```

Then run:

```bash
python backend/scripts/create_survey_config.py \
  --name "My Survey" \
  --asset-id "your_kobo_asset_id" \
  --config-file config.json
```

### Option C: Via API (if endpoint exists)

```bash
curl -X POST http://localhost:8000/api/surveys \
  -H "Content-Type: application/json" \
  -d '{
    "survey_name": "My Survey",
    "kobo_asset_id": "your_kobo_asset_id",
    "config_data": {...}
  }'
```

## Step 3: Test the ETL Pipeline

### Option A: Using the Test Script

```bash
# First, check your setup
python backend/scripts/test_etl.py

# Then run the pipeline with a small limit (for testing)
python backend/scripts/test_etl.py --run <survey_id> --limit 5
```

The test script will:
- Check environment variables
- Verify database connection
- List existing surveys
- Test Kobo API connection
- Run the ETL pipeline

### Option B: Using the CLI Script

```bash
python backend/scripts/run_etl.py <survey_id> --limit 5
```

### Option C: Via API Endpoint

```bash
curl -X POST "http://localhost:8000/api/etl/run/<survey_id>?limit=5"
```

## Step 4: Verify Results

### Check Submissions in Database

```bash
# Via API
curl http://localhost:8000/api/submissions?page_size=10

# Or check directly in database
docker-compose exec postgres psql -U postgres -d field_compass -c "SELECT _id, _uuid, qa_status, array_length(data_quality_issues, 1) as issue_count FROM submissions_current LIMIT 10;"
```

### Check HFC Results

```bash
# Get submissions with HFC flags
curl "http://localhost:8000/api/submissions?qa_status=HFC_FLAGGED"

# Get a specific submission
curl http://localhost:8000/api/submissions/123
```

### Check Edit History

```bash
# Get submission history
curl http://localhost:8000/api/submissions/123/history
```

## Troubleshooting

### Error: "KOBO_API_TOKEN is not set"
- Make sure you have a `.env` file with `KOBO_API_TOKEN=your_token`
- Verify the token is valid at https://kf.kobotoolbox.org/token/

### Error: "Survey configuration not found"
- List surveys: `python backend/scripts/test_etl.py`
- Create a survey configuration first (Step 2)

### Error: "Survey does not have a kobo_asset_id configured"
- Update the survey configuration to include the `kobo_asset_id`
- Or create a new survey with the asset ID

### Error: "Database connection failed"
- Make sure Docker is running: `docker ps`
- Start services: `make up`
- Check database logs: `docker-compose logs postgres`

### No submissions fetched
- Verify the Kobo asset ID is correct
- Check if the survey has any submissions in KoboToolbox
- Try fetching with a larger limit or no limit
- Check Kobo API logs/errors

### HFC checks not working
- Verify survey configuration has the correct field names
- Check that validation rules are created in the database
- Review HFC engine logs for errors

## Next Steps

Once testing is successful:

1. **Add Validation Rules**: Create custom validation rules in the `validation_rules` table
2. **Schedule ETL**: Set up Airflow DAG for automated ETL runs
3. **Monitor Performance**: Check pipeline statistics and optimize if needed
4. **Scale Up**: Remove the `--limit` flag to process all submissions

## Example: Complete Test Workflow

```bash
# 1. Set up environment
echo "KOBO_API_TOKEN=your_token" >> .env

# 2. Start services
make up

# 3. Create survey config
python backend/scripts/create_survey_config.py \
  --name "Test Survey" \
  --asset-id "abc123xyz" \
  --use-defaults

# 4. Test with small sample
python backend/scripts/test_etl.py --run <survey_id> --limit 5

# 5. Verify results
curl http://localhost:8000/api/submissions?page_size=5

# 6. Run full pipeline (when ready)
python backend/scripts/run_etl.py <survey_id>
```


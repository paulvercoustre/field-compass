# Frontend Setup Guide

## Current Status

The frontend is now connected to the real API! Here's what you need to know:

## Configuration

### API URL
- **Default**: `http://localhost:8000` (automatically used)
- **Custom**: Set `VITE_API_URL` in `.env` file if your backend is on a different URL

### What Works Without Configuration

✅ **Submissions Dashboard**
- Shows all submissions from database
- No configuration needed
- Filters by QA status work
- Submission details and history work

✅ **Submission List & Details**
- All submission data displays
- Edit history shows JSON patches
- Quality issues display correctly

### What Needs Survey Configuration

⚠️ **Progress Tracking** (`/api/progress`)
- **Requires**: `survey_id` parameter
- **Why**: Needs survey config to know which fields to use for district/livelihood grouping
- **Current**: Works without `survey_id` but returns basic overall progress only

⚠️ **Performance Tracking** (`/api/performance`)
- **Requires**: `survey_id` parameter  
- **Why**: Needs survey config to identify enumerator field name
- **Current**: Works without `survey_id` but uses default field names

## Getting Your Survey ID

To use progress/performance features, you need your survey's UUID:

```bash
# Get survey ID from database
docker-compose exec postgres psql -U postgres -d field_compass -c \
  "SELECT survey_id, survey_name FROM survey_configs;"
```

The `survey_id` is a UUID like: `bdad3023-12ec-461c-8744-8e28b93519d7`

## Testing the Frontend

1. **Make sure backend is running**:
   ```bash
   docker-compose ps
   # Should show backend and postgres running
   ```

2. **Check API is accessible**:
   ```bash
   curl http://localhost:8000/api/submissions?page_size=2
   ```

3. **Open frontend**:
   - URL: http://localhost:3000
   - Dashboard should show real submissions
   - Progress pages may show limited data without survey_id

## Troubleshooting

### No submissions showing?
- Check if backend is running: `docker-compose ps`
- Check browser console for errors (F12)
- Verify API: `curl http://localhost:8000/api/submissions`

### Progress/Performance pages empty?
- These require a `survey_id` to work properly
- Without it, they'll show basic overall stats only
- To fix: Pass `survey_id` to the API calls (we can add this to the UI)

### CORS errors?
- Backend CORS is configured for `localhost:3000`
- If using a different port, update `backend/main.py` CORS settings

## Next Steps

1. **Add Survey Selection UI** - Let users select which survey to view
2. **Add Survey ID to Progress Calls** - Pass survey_id to progress/performance APIs
3. **Better Error Messages** - Show helpful messages when data is missing



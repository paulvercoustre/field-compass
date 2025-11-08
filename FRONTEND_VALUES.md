# Frontend Configuration Values

## What You Need to Know

The frontend is now connected to the real API! Here's what values you should be using:

## ✅ No Configuration Needed For:

### Submissions Dashboard
- **Works immediately** - Shows all submissions from database
- **No values needed** - Just refresh the page
- You should see your 7 real submissions from Kobo

### Submission Details
- **Works immediately** - Click any submission to see details
- **History works** - Shows edit history if submissions were edited

## ⚙️ Optional: Survey ID for Progress/Performance

### Your Survey ID
```
bdad3023-12ec-461c-8744-8e28b93519d7
```

### What It's Used For:
- **Progress Tracking**: Groups data by district/livelihood
- **Performance Tracking**: Groups data by enumerator

### Current Status:
- ✅ **Works without survey_id** - Shows overall progress
- ✅ **Works better with survey_id** - Shows district/livelihood breakdowns

### How to Use Survey ID:
Currently, the frontend doesn't have a UI to select surveys. The progress/performance pages will:
- Work without survey_id (shows all data)
- Work better if we add survey selection (future enhancement)

## 📊 What Data You Should See

### Submissions Page
- **7 submissions** from your Kobo survey
- Real submission data with quality issues
- Edit history (if any submissions were edited)

### Progress Page
- **Overall**: 7 conducted interviews
- **By District**: Grouped by `sampling_information/sampling_admin2` (e.g., "zaranj")
- **By Livelihood**: Grouped by `sampling_information/sampling_livelihood` (e.g., "Opening cafés and restaurants")

### Performance Page
- **Enumerator stats**: Grouped by `sampling_information/enumerator_id` (e.g., "ZA04")
- Shows validation rates and quality metrics

## 🔧 Configuration Values in Survey Config

Your survey config already has the right values:
- `sampling_cols: ["sampling_admin2", "sampling_livelihood"]` ✅
- `enumerator: "enumerator_id"` ✅

The system automatically finds the full paths:
- `sampling_admin2` → finds `sampling_information/sampling_admin2` ✅
- `sampling_livelihood` → finds `sampling_information/sampling_livelihood` ✅
- `enumerator_id` → finds `sampling_information/enumerator_id` ✅

## 🐛 Troubleshooting

### "No submissions showing"
- Check browser console (F12) for errors
- Verify backend is running: `docker-compose ps`
- Test API: `curl http://localhost:8000/api/submissions`

### "Progress shows Unknown"
- This was fixed! The path-based lookup now works
- Refresh the page to see real district/livelihood names

### "Performance shows Unknown enumerators"
- This was fixed! The path-based lookup now works
- Refresh the page to see real enumerator IDs like "ZA04"

## Summary

**You don't need to configure anything!** The frontend should work with your existing data. Just refresh the page and you should see:
- Real submissions from your database
- Real progress data grouped by district/livelihood
- Real performance data grouped by enumerator



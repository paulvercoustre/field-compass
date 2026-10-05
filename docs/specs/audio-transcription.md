# Design: Audio transcription, and background work you can see

Status: implemented (phases 1–5) · Branch: `claude/audio-transcription` · See §13 for
what changed from the draft while building it.

## 1. Summary

Audio answers are invisible to Field Compass today. A form can ask for a
recorded answer, but the recording is never listened to, checked or
summarised: the submission shows a filename.

This design does two things.

**A. Transcribe audio answers with ElevenLabs.**

1. A survey owner picks the audio questions to transcribe. Each new
   recording is sent to ElevenLabs Scribe (`scribe_v2`) in the background,
   and the transcript is stored and shown next to a player in the
   submission.
2. Optionally, transcripts are **sent to Kobo** as Kobo's own transcript of
   that question (option A of the earlier discussion). They appear in
   Kobo's data table and exports, next to the recording. The submission
   itself is not changed.
3. Later, AI checks read transcripts like any text answer, and cheap
   built-in checks flag empty recordings or answers in an unexpected
   language.

**B. Make background work visible.** Pulls, AI checks and transcriptions run
out of sight today. A pull becomes a recorded **run** with live progress
(stages, counts, time left, problems in words). It shows on every page and
ends in an in-app **notification**. Transcription is built on this from the
start, rather than being a second invisible queue.

Part B is useful without Part A and comes first in the delivery plan (§9).

## 2. Why

### 2.1 Audio answers are unused

Open-ended audio questions are common in qualitative and monitoring
surveys: they are faster for enumerators and capture more than typed
answers. Supervisors still have to listen to each one to know whether it
was answered, answered in the right language, or answered at all.

Kobo has automatic transcription built in, using Google, but the Community
plan gets 10 minutes a month. Each transcript has to be requested and
accepted by hand in Kobo's processing screen, and nothing checks the
result. Running transcription from Field Compass gives:

- every recording transcribed as it arrives, with no clicks;
- a model with good coverage of the languages field teams work in (Scribe
  lists 100);
- a predictable cost, metered and capped like AI checks (§4.6);
- transcripts that feed quality checks, which is what Field Compass is for.

### 2.2 Background work is invisible

Found while reading the code on 2026-10-03:

| Problem | Where |
|---|---|
| A pull runs inside the HTTP request. The page shows a spinner until the whole pipeline finishes, and the summary is lost if the user leaves or reloads. A large pull holds a backend worker for minutes. | `backend/routers/etl.py:25`: "This runs synchronously" |
| AI check progress is only visible through an 8-second re-fetch of the submission list, which downloads every matching submission page by page each time. It runs only while a submission matching the current filters is pending, and only on the Submissions page. | `frontend/components/Dashboard.tsx:160` |
| No survey-wide count ("80 of 200 checked"), no time left, and no moment that says "done". | — |
| No other page knows work is running. Starting a pull and opening Quality Overview shows stale numbers with no hint. | — |
| Failures are visible one submission at a time. "AI checks paused: the provider rejected the key" exists only in the pull banner of the pull that hit it. | `Dashboard.tsx:197` |
| No record of past pulls: who ran one, when, what it found. | — |

Transcription would make this worse. Recordings take longer than text checks
and cost per minute, so users need to see what is queued, what it costs and
when it is done.

## 3. Goals and non-goals

**Goals**

- Transcribe selected audio questions automatically on each pull, once per
  recording.
- Show the transcript and a working player in the submission.
- Send transcripts to Kobo through its supplement API, never overwriting a
  correction made in Kobo.
- Meter transcription in `ai_usage` (in minutes) under a free monthly
  allowance per survey.
- A pull, and the background work it starts, has a visible, reload-safe
  progress view and a clear end.
- Users are told, in the app, when work finishes or stops for a reason
  they can fix.

**Non-goals (this design)**

- Background audio (`background-audio`, the whole-interview recording) and
  `audit` audio. They are long, costly and need consent rules of their own.
  Possible later with the webhook mode (§4.3).
- Audio questions inside **repeat groups**. Kobo's supplement keys a
  transcript by question path, and how it handles repeat instances must be
  checked first (§12).
- Translation. Kobo can machine-translate a transcript once it is there.
  (Since added with AI: see translation.md.)
- Users' own ElevenLabs keys, and organisation-owned providers. The
  operator's key comes first, as AI checks did (§4.7).
- Email notifications. The backend sends no email today; in-app and
  browser notifications come first (§6.5).
- Real-time push (WebSocket/SSE). Polling a small endpoint is enough at this
  scale (§6.4).

## 4. Part A — Transcription

### 4.1 Which recordings

A survey's settings list the form's `audio` questions (from the stored
`kobo_tool`). The owner ticks the ones to transcribe. For each submission
and ticked question with an answer:

1. The answer value is the recording's filename.
2. The matching file is the entry in `_attachments` whose `question_xpath`
   equals the question path. On servers without `question_xpath`, the entry
   whose `media_file_basename` (or the basename of `filename`) equals the
   answer.
3. Its `uid` identifies the recording. A re-pull with the same `uid` is
   never transcribed again. An edit in Kobo that replaces the recording
   gives a new `uid` and a new transcript.

No attachment, or `is_deleted` set → `skipped` with reason `missing_file`.

### 4.2 Flow

```
Pull (run R)
  └─ for each new/changed (submission, audio question):
       upsert audio_transcripts row → status pending, run_id R
       enqueue transcribe_recording_task          (queue: transcriptions)

transcribe_recording_task
  1. Lock the row; drop the job if it is stale (input_hash changed)
  2. Download the recording from Kobo with the Kobo token of the user who
     started the run (stream to a temp file; delete it afterwards)
  3. Measure its length (ffprobe). Too long → skipped: too_long
  4. Reserve its minutes against the allowance (§4.6), or not_run_allowance
  5. POST to ElevenLabs (§4.3)
  6. Store text, language and length → success; settle usage
  7. If "Send to Kobo" is on → enqueue send_transcript_to_kobo_task (§5)
  8. If an AI check is waiting for this transcript → enqueue it (§4.8)
  9. If this was the run's last open item → finish the run (§6.2)
```

Retries, backoff and the stalled-job sweep work as they do for qualitative
checks (`services/qualitative_worker.py`), on their own queue. A long
recording then never delays AI checks, and the two can be scaled
separately.

Recordings cannot be passed to ElevenLabs by URL (`source_url`). Kobo
attachment links need the user's token, so the worker downloads the file
and uploads it.

### 4.3 ElevenLabs request

`POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`,
multipart body:

| Field | Value |
|---|---|
| `model_id` | `scribe_v2` (setting `TRANSCRIPTION_MODEL`) |
| `file` | the recording |
| `language_code` | the survey's language if set; omitted for automatic detection |
| `diarize` | `true` when the survey says recordings have several speakers |
| `tag_audio_events` | `false`: keeps "(laughter)" and the like out of the text |
| `timestamps_granularity` | `word` when diarising (speaker labels come on words), otherwise `none` |

The response gives `text`, `language_code`, `language_probability`,
`words[]` (with `speaker_id` when diarised) and `audio_duration_secs`.
Speaker turns are built from `words` and stored as `segments`. Words
themselves are not stored.

**Synchronous calls only, at first.** Answers to a question are usually
under a few minutes. The request timeout scales with length (60 s + 0.5 s
per second of audio, capped at 15 min), and recordings over
`TRANSCRIPTION_MAX_SECONDS` (default 1800) are skipped. ElevenLabs'
`webhook` mode (202 now, result posted later) is the path for long
recordings and background audio. It needs a public callback endpoint with
signature checking, so it comes later.

**Errors** map onto the existing `AIError` categories, so stored errors and
UI wording work the same way:

| ElevenLabs response | Category | Retry |
|---|---|---|
| 401, invalid key | `auth` | no; pauses transcription for the survey |
| 402, or a quota/credits error | `provider_quota` | no; pauses |
| 429 (rate or concurrency limit) | `rate_limited` | yes, honouring `Retry-After` |
| 5xx, connection error | `unavailable` | yes |
| timeout | `timeout` | yes |
| 400/422 (e.g. unsupported format) | `bad_request` | no |

Exact status codes and error bodies are pinned down in contract tests
(§10) before release.

**Audio formats.** KoboCollect records `.m4a` by default. Older devices and
Enketo can produce `.amr`, `.3gp`, `.ogg` or `.webm`. Each is tested against
Scribe early in phase 2. Any it rejects is converted to `.m4a` with
`ffmpeg` in the worker image (already needed for `ffprobe`).

**Configuration** (operator, `.env`): `ELEVENLABS_API_KEY`,
`ELEVENLABS_BASE_URL` (default `https://api.elevenlabs.io`, so a regional
endpoint can be used), `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_MAX_SECONDS`,
and the allowance (§4.6). Transcription is unavailable, and its settings
card says so, when the key is unset.

### 4.4 Code layout

- `services/transcription_client.py`: `TranscriptionClient.transcribe(path,
  options) -> TranscriptResult`. It owns the HTTP call, the timeout, error
  mapping and the usage record. It is separate from `AIClient`, which
  speaks OpenAI-compatible chat completions; the two share `ai_errors` and
  `ai_usage`, not code.
- `services/transcription_worker.py` + `_runtime.py`: the Celery task and
  its body, mirroring the qualitative worker split.
- `etl/audio.py`: finding audio questions and matching attachments (§4.1).
- `etl/kobo_fetcher.py`: `download_attachment()` (streamed, size-capped)
  and the supplement calls of §5.
- `etl/pipeline.py`: queues transcriptions after the deterministic checks,
  next to where AI checks are queued.

### 4.5 Data model

**`audio_transcripts` (new)**, one row per (submission, audio question):

| Column | Notes |
|---|---|
| `transcript_id` | PK |
| `survey_id`, `submission_id` | FK survey; Kobo `_id` |
| `question_path` | e.g. `interview/q_story` |
| `attachment_uid` | Kobo attachment `uid` |
| `input_hash` | question path + attachment uid; a new recording re-transcribes (settings changes do not: see §13) |
| `status` | `pending` · `running` · `success` · `failed` · `skipped` · `not_run_allowance` · `cancelled` |
| `skip_reason` | `missing_file` · `too_long` · `no_speech` |
| `text`, `segments` (JSONB, speaker turns) | |
| `language_code`, `language_probability`, `audio_seconds` | as returned |
| `model`, `last_error` (`"<category>: <message>"`) | |
| `run_id`, `job_id`, `queued_at`, `started_at`, `finished_at` | §6 |
| `kobo_status` | `not_sent` · `pending` · `sent` · `failed` · `unsupported` · `edited_in_kobo` |
| `kobo_version_uuid`, `kobo_sent_at`, `kobo_last_error` | §5 |

Unique on (`survey_id`, `submission_id`, `question_path`); indexed on
(`run_id`, `status`).

**`ai_usage`**: new `feature = "transcription"` and a nullable
`audio_seconds` column. Cost is computed from seconds (§4.6), not tokens.

**Survey settings** (`config_data.audio_transcription`):

```json
{
  "enabled": true,
  "questions": ["interview/q_story", "q_feedback"],
  "language": null,
  "multiple_speakers": false,
  "send_to_kobo": false
}
```

Migration `0006` adds the table and column; `0007` adds runs and
notifications (§6.3). Their order follows the delivery plan.

### 4.6 Cost and allowance

ElevenLabs bills per hour of audio. Third-party listings give about
$0.22–0.27 per hour for `scribe_v2` batch. This must be confirmed on
ElevenLabs' pricing page and entered in `services/ai_prices.json` as a
per-second price. `cost_usd_micros` is then `audio_seconds × price`, like
the other features.

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIPTION_ALLOWANCE_MINUTES_PER_SURVEY_MONTH` | 120 | Minutes per survey per calendar month (UTC) on the operator key |
| `TRANSCRIPTION_MAX_SECONDS` | 1800 | Longest single recording sent |

At the listed price, 120 minutes is under $1 per survey per month.

Recording lengths are unknown until the file is downloaded, so the
allowance is enforced at run time, not at queue time. Under a per-survey
Postgres advisory lock, the worker sums this month's seconds (settled plus
reserved) and adds a `reserved` usage row for this recording. If that would
exceed the allowance, the transcript is stored as `not_run_allowance`. The
row is settled to `ok` or the error category after the call. A failed call
is not counted: ElevenLabs does not bill it. The next pull re-queues
`not_run_allowance` recordings once there is allowance again.

### 4.7 Who pays: keys

Phase 2 runs on the operator's `ELEVENLABS_API_KEY` only. `AIConnection` is
shaped around OpenAI-compatible chat endpoints (`base_url`, `check_model`,
capability profile) and does not fit. A user's or an organisation's own
ElevenLabs key comes with organisation-owned providers, the next step
already planned in `docs/specs/ai-provider-overhaul.md` §11. The schema
leaves room: `audio_transcripts` records `model`, and `ai_usage` records
`connection_id`.

### 4.8 Transcripts in quality checks (phase 5)

- **Built-in checks**, deterministic and free, from transcription results:
  - *Recording has no speech*: empty text, or under 2 seconds.
  - *Recording not in the expected language*: the detected language differs
    from the survey's language with probability ≥ 0.8. Only when a
    language is set.

  These are ordinary `data_quality_issues` and count toward `qa_status`.
- **AI checks.** Selected audio questions appear in "Text Fields to
  Analyze" as "Story (transcript)". A submission whose AI check covers an
  audio question waits until that transcript is finished (new status
  `waiting`, shown as "Waiting for the transcript…"). The transcription
  task queues the check when it is done. The transcript text is part of
  `llm_input_hash`, so a re-transcription re-checks.

### 4.9 UI

**Survey Settings › Audio transcription**, a new card after Qualitative
Quality Checks (owner and editors can view; owner can change):

- "Transcribe audio answers" toggle.
- Checklist of the form's audio questions, with labels. With none: "This
  form has no audio questions."
- Language: "Detect automatically" (default) or a language. Hint: "Choosing
  the language improves accuracy and lets Field Compass flag answers in
  another language."
- "Recordings often have more than one speaker" (diarisation).
- "Send transcripts to Kobo" (off by default), with the explanation and the
  status line of §5.4.
- What is sent: "Recordings of the selected questions are sent to
  ElevenLabs to be transcribed. Nothing else from the submission is sent."
  Plus a link to the data note (§7).
- "Re-run transcription" (owner). It opens the app's modal (not
  `confirm()`) with an estimate: "About 340 recordings, roughly 9 hours of
  audio. This survey has 74 minutes left this month."

**Submission detail.** Each transcribed audio answer shows:

- a player, streamed through `GET /api/submissions/{kobo_id}/audio?question=…`
  (checks survey access, fetches from Kobo with the viewer's token,
  supports `Range` so seeking works);
- the transcript, with "Speaker 1 / Speaker 2" turns when diarised, and the
  detected language;
- a status line in the same tones as the AI section: "Transcribing…",
  "Not transcribed: this survey has used its 120 free minutes for October.",
  "Couldn't transcribe: the recording format isn't supported.";
- the Kobo line: "In Kobo ✓", "Not sent to Kobo", "Corrected in Kobo — the
  correction is kept", or "Couldn't send to Kobo: your Kobo account can't
  edit this project's submissions."

**Submission list.** A small transcript icon on rows with transcripts, and
filters "Transcription failed" and "No speech".

**Account Settings › AI use.** Each survey row gains "Transcription: 34 of
120 min". Usage stays in Account Settings, as decided for AI usage.

## 5. Part A — Sending transcripts to Kobo

### 5.1 Kobo's supplement API

Recent KoboToolbox versions store processing results (transcripts,
translations, qualitative analysis) as a **supplement** to a submission
(`kobo/apps/subsequences` in `kobotoolbox/kpi`). A *manual* transcript is
accepted on creation. It is then the question's selected transcript, shown
in the data table and included in exports, and anyone can correct it in
Kobo's processing screen.

1. **Enable it on the question** (once per question and language):

   `POST /api/v2/assets/{asset_uid}/advanced-features/`
   ```json
   {"question_xpath": "q_story", "action": "manual_transcription", "params": [{"language": "fr"}]}
   ```
   A new language is added with
   `PATCH /api/v2/assets/{asset_uid}/advanced-features/{feature_uid}/`
   and the full `params` list.

2. **Add the transcript** (per submission):

   `PATCH /api/v2/assets/{asset_uid}/data/{root_uuid}/supplement/`
   ```json
   {"_version": "20250820", "q_story": {"manual_transcription": {"language": "fr", "value": "…"}}}
   ```
   `20250820` is Kobo's current supplement schema version
   (`SUBSEQUENCES_SCHEMA_VERSION`). It is a setting
   (`KOBO_SUPPLEMENT_VERSION`) so a schema bump does not need a release.

3. **Read it back**: `GET` on the same path returns every version, each with
   a `_uuid` and dates.

### 5.2 Rules

- **Never overwrite a correction.** We store the `_uuid` of the version we
  created. Before sending a newer transcript (after a re-transcription), the
  worker reads the supplement. If the selected version is not ours, someone
  edited it in Kobo: we do not send, and mark `edited_in_kobo`.
- **Language.** Use the survey's language when set. Otherwise use the
  detected one, mapped to the code Kobo's language list uses: ISO 639-1
  where one exists (`fra` → `fr`), otherwise the 639-3 code. A detected
  language not yet in the feature's `params` is added first (§5.1, step 1).
- **Which submission.** `root_uuid` is `meta/rootUuid` from the submission
  data, falling back to `_uuid`, with any `uuid:` prefix stripped. Which
  form the endpoint accepts is confirmed against a real server in phase 3.
- **Which token.** That of the user who started the run, as for the
  download. Writing a supplement needs permission to edit submissions in
  the Kobo project.
- **Rate.** At most 2 requests per second per Kobo server (Celery
  `rate_limit` on the task), so a large backlog does not trip Kobo's API
  limits.
- **Turning it off** stops sending. What is already in Kobo stays there;
  removing it is done in Kobo.
- Kobo also has a bulk endpoint (`POST …/data/supplements/bulk/`), used
  today for accepting results. Per-submission `PATCH` is enough for v1.

### 5.3 Failures

| Kobo response | `kobo_status` | What happens |
|---|---|---|
| 404 on `advanced-features` | `unsupported` | The server predates the supplement API. The settings card says so; nothing is retried. |
| 403 | `failed`, `kobo_permission` | After 3 in a row for a survey, sending pauses and the owner is notified (§6.5). Resumes when the setting is saved again. |
| 400 | `failed`, `bad_request` | Kept with Kobo's message; usually a language or path problem. |
| 429, 5xx, timeout | `pending` | Retried with backoff. |

`POST /api/surveys/{id}/transcripts/send-to-kobo` (owner) re-sends every
`not_sent` and `failed` transcript, e.g. right after the setting is turned
on for a survey that already has transcripts.

### 5.4 Settings card status line

- "Kobo is set up to receive transcripts for 2 questions."
- "312 transcripts sent to Kobo · 4 corrected in Kobo · 2 couldn't be sent."
- "Your Kobo server doesn't support adding transcripts. Transcripts stay in
  Field Compass."
- "Paused: your Kobo account can't edit this project's submissions. Ask the
  project owner for 'Edit submissions' permission, then save this setting
  again."

## 6. Part B — Background work you can see

### 6.1 Runs

A **run** is one pull and everything it starts: fetching from Kobo, the
deterministic checks, AI checks, transcriptions and sending to Kobo. "Re-run
AI checks" and "Re-run transcription" also create runs.

- `POST /api/etl/run/{survey_id}` starts a Celery task (queue `pulls`) and
  returns `202 {"run_id": …}` immediately. The pipeline is unchanged; it
  reports its stage and counts to the run row as it goes.
- One active pull per survey: a second request gets `409` with "A pull is
  already running, started by Amina at 14:02", and the UI shows that run.
- Each AI check and transcription records the run that queued it
  (`submissions_current.llm_run_id`, `audio_transcripts.run_id`). Progress
  is a `GROUP BY status` over those rows, which is cheap with the index.
- An item re-queued by a later pull moves to that run. The earlier run
  shows it as "handed to a later pull", so no run waits forever.
- **Finishing.** Every worker task ends by checking, under a row lock on the
  run, whether any of its items are still `pending`/`running`. The last one
  marks the run `finished` and creates its notification. The 5-minute sweep
  also finishes runs whose items have all ended, as a backstop.
- **Stop.** `POST /api/runs/{run_id}/stop` (whoever started it, or the
  owner) marks its queued items `cancelled` and revokes their tasks. Items
  already running finish. A cancelled item is queued again by the next pull.

### 6.2 What a run reports

```json
{
  "run_id": "…", "survey_id": "…", "kind": "pull",
  "status": "running",
  "started_by": {"name": "Amina"}, "started_at": "…", "finished_at": null,
  "stage": "background",
  "pull": {"fetched": 1240, "new": 40, "edited": 3, "flagged": 12},
  "ai_checks": {"queued": 200, "done": 80, "failed": 2, "not_run": 0, "eta_seconds": 180},
  "transcripts": {"queued": 40, "done": 12, "failed": 0, "not_run": 0, "minutes": 31, "eta_seconds": 240},
  "kobo": {"queued": 12, "sent": 10, "failed": 0},
  "problems": [
    {"kind": "ai_paused", "text": "AI checks paused: the AI provider rejected the key.", "action": "open_ai_providers"}
  ]
}
```

Stages: `queued` → `fetching` → `checking` → `background` (AI checks,
transcriptions, Kobo) → `finished` / `failed`. Time left comes from the rate
over the last two minutes, shown once 10 items are done, and rounded
("about 3 minutes left").

### 6.3 Data model

**`runs` (new)**: `run_id`, `survey_id`, `kind` (`pull` · `ai_rerun` ·
`transcription_rerun` · `kobo_resend`), `started_by_user_id`, `status`,
`stage`, `stats` (JSONB: the pull's counts, today's `etl/run` response),
`error`, `created_at`, `started_at`, `finished_at`. Kept for 90 days, which
gives the "Recent activity" list for free.

**`notifications` (new)**: `notification_id`, `user_id`, `survey_id`,
`run_id`, `kind`, `severity` (`info` · `warning`), `title`, `body`, `link`
(an in-app route with filters), `created_at`, `read_at`. One open "paused"
notification per survey and cause; a repeat updates it rather than adding
another.

### 6.4 Endpoints and polling

| Endpoint | Purpose |
|---|---|
| `GET /api/activity` | Active runs across the user's surveys, plus runs finished in the last 10 minutes. Feeds the global indicator. |
| `GET /api/runs/{run_id}` | One run, as in §6.2 |
| `GET /api/surveys/{survey_id}/runs?limit=20` | Recent activity for a survey |
| `POST /api/runs/{run_id}/stop` | §6.1 |
| `GET /api/notifications` · `POST /api/notifications/read` | List; mark some or all read |

The frontend polls `GET /api/activity` every 4 s while a run is active,
every 60 s otherwise, and on window focus. It replaces the blind
submission-list poll in `Dashboard.tsx`: the dashboard re-fetches its list
only when a run's counts for that survey change. Push (SSE) can replace
polling later without changing these shapes.

### 6.5 UI

**Activity indicator.** In the app header, on every page. While anything
runs: a spinner and one line, e.g. "Household survey: AI checks 80 of 200".
With several runs: "3 things running". Clicking it opens the activity
panel.

**Activity panel** (a drawer). Per active or recently finished run:

```
Household survey · pull started by Amina, 14:02
  ✓ Fetched from Kobo        1,240 submissions · 40 new · 3 edited
  ✓ Quality checks           12 flagged
  ● AI checks                80 of 200 · about 3 min left       ▓▓▓▓░░░░
  ● Transcripts              12 of 40 · 31 min of audio         ▓▓▓░░░░░
  ● Sent to Kobo             10 of 12
  ! AI checks paused: the AI provider rejected the key.  [Update the key]
                                                     [Stop remaining work]
```

Each count links to the dashboard with the matching filter ("2 failed" →
AI check: failed). "Stop remaining work" uses the app's modal dialog.
Below the runs: "Recent activity", the survey's last runs with their
summaries.

**Dashboard.** "Pull from Kobo" no longer blocks. The long "ETL completed:
… fetched, … created …" sentence becomes a run card at the top of the
list, with the stage lines above. It survives reloads because it reads the
run, and closes when dismissed. The word "ETL" disappears from the UI.

**Notifications.** A bell next to the activity indicator, with an unread
count. A notification is created when:

- a pull and all its background work finish: "Household survey: 40 new
  submissions, 12 flagged. AI checks and 40 transcripts done.";
- a pull fails: "Couldn't pull Household survey from Kobo: the Kobo key was
  rejected.";
- work pauses for a reason someone must fix: AI provider key rejected or out
  of credit, free allowance used up, ElevenLabs out of credit, Kobo
  permission missing.

Recipients: the person who started the run; for pauses, also the survey
owner. Not one notification per submission.

**Browser notifications** (opt-in, Account Settings › Notifications): "Tell
me when a pull and its checks finish, even when Field Compass is in another
tab." Shown by the polling client through the Notification API when a run
finishes while the tab is hidden. No service worker needed.

**Survey cards / selector.** A small "Pulling…" or "Checking…" badge on
surveys with an active run.

## 7. Privacy and security

- **Consent.** Sending a respondent's voice to a third party must be
  covered by the survey's consent wording and the organisation's data
  agreements. The settings card says what is sent, and turning
  transcription on needs a one-time acknowledgement in the app's modal:
  "Respondents' recordings will be sent to ElevenLabs…". Wording to be
  signed off as for AI checks (provider overhaul §14, question 6).
- **Retention at ElevenLabs.** ElevenLabs offers a zero-retention mode
  (`enable_logging=false`) on some plans. Confirm whether our plan has it,
  and send the flag when it does (setting `ELEVENLABS_ZERO_RETENTION`).
  Check whether a regional (EU) endpoint is available; `ELEVENLABS_BASE_URL`
  allows one.
- **Retention here.** Recordings are never stored by Field Compass. They are
  streamed to a temp file, sent, and deleted, and the player proxies from
  Kobo. Transcripts are stored and deleted with the survey.
- **Keys.** `ELEVENLABS_API_KEY` stays in the environment and is never
  logged; the client logs host, model, length and category only.
- **Access.** The audio endpoint checks survey access and uses the
  viewer's own Kobo token, so nobody hears a recording they could not open
  in Kobo. Transcripts are visible to everyone with survey access, like
  answers.
- **Download limits.** Attachment downloads follow only Kobo's own redirect
  (to its storage), are capped at 200 MB, and go to the configured Kobo
  server only.

## 8. Worker capacity

The single worker container today listens to `qualitative_checks` and runs
beat (`docker-compose.prod.yml`). It becomes:

```
celery … worker -Q pulls,qualitative_checks,transcriptions,kobo_sync -B --concurrency=4
```

`TRANSCRIPTION_CONCURRENCY` caps simultaneous ElevenLabs calls through
Celery's per-worker rate limit: ElevenLabs limits concurrent requests per
plan. Separate worker containers per queue are a config change if a busy
survey needs them.

## 9. Delivery plan

Each phase ships on its own.

| Phase | Scope | Notes |
|---|---|---|
| **1. Runs and progress** | `runs` table; pull as a Celery task returning `run_id`; one pull per survey; run ids on AI checks; finishing logic and sweep; `GET /api/activity`, `/runs/{id}`, `/surveys/{id}/runs`; activity indicator, panel and dashboard run card; replace the blind poll; stop | Useful now for AI checks; transcription builds on it |
| **2. Transcription in Field Compass** | `audio_transcripts`, `ai_usage.audio_seconds`; question matching; download; `TranscriptionClient`; worker and queue; allowance; settings card; player endpoint; transcript in submission detail; usage row in Account Settings; format tests | Operator key only |
| **3. Send to Kobo** | Feature setup, supplement `PATCH`, correction guard, language mapping, failures and pause, re-send endpoint, status line | Test against kf.kobotoolbox.org and eu.kobotoolbox.org first |
| **4. Notifications** | `notifications` table and endpoints; bell; events of §6.5; browser notifications opt-in | Can move before 2 |
| **5. Transcripts in checks** | "No speech" and "unexpected language" checks; audio questions selectable for AI checks; `waiting` status | |
| **Later** | Webhook mode for long recordings and background audio; reading Kobo corrections back into Field Compass; users' or organisations' own ElevenLabs keys; email digests; SSE | |

## 10. Testing

- **ElevenLabs contract tests** against a fake server (extend
  `docs/ui-ux-review/fixtures/mock_services.py`): success with and without
  diarisation; each error row of §4.3 → category → stored status and retry
  decision; timeout scaling; no key → `not_configured`.
- **Attachment matching**: `question_xpath` present and absent; grouped
  questions; deleted attachment; edited submission with a replaced
  recording (new transcript) and with an unchanged one (none).
- **Allowance**: concurrent tasks under the advisory lock never exceed the
  minutes; failed calls are not counted; `not_run_allowance` is re-queued
  next month.
- **Kobo supplement**: fake Kobo for enable, add-language, `PATCH`; the
  correction guard (selected version not ours → no write); 403 ×3 pauses;
  404 → `unsupported`. One manual test on a real Kobo project per server
  before release, including what the export shows.
- **Runs**: the last item finishes the run exactly once (two tasks ending
  together); a re-queued item moves runs; a stopped run cancels queued
  items only; a crashed pull ends `failed` with its error.
- **Formats** (phase 2, manual): `.m4a`, `.amr`, `.3gp`, `.ogg`, `.webm`
  recorded by KoboCollect and Enketo, through Scribe.
- **No audio kept**: after a task, its temp file is gone, success or not.

## 11. Rollout

- Transcription is off for every survey until an owner turns it on. "Send
  to Kobo" is off until turned on separately.
- Phase 1 changes how "Pull from Kobo" behaves for everyone: it returns at
  once and shows progress. Scripts that called `POST /api/etl/run` and read
  the counts from its response get `?wait=true` for one release, which keeps
  the old synchronous response.
- Production needs `ELEVENLABS_API_KEY` in `~/field-compass/.env` on the VM,
  `ffmpeg` in the backend image, and the worker command of §8.
- Watch the first week's `ai_usage` minutes and cost per survey before
  raising the allowance default.

## 12. Open questions

1. **Repeat groups.** Does Kobo's supplement support audio questions inside
   repeats, and how are instances addressed? If not, they stay out of
   scope.
2. **Corrections from Kobo.** When someone corrects a transcript in Kobo,
   should Field Compass read it back and use it for checks (proposed:
   later)? That needs a supplement read per transcribed submission on pull.
3. **Allowance size and unit.** 120 minutes per survey per month is a
   placeholder. Minutes per survey, or per organisation once that exists?
4. **Language codes.** Confirm the form of ElevenLabs' `language_code`
   (ISO 639-3 or 639-1), and which codes Kobo's language list accepts for
   languages without a 639-1 code.
5. **Kobo version.** Which KoboToolbox release introduced the supplement
   API, so the "not supported" message can name it? Self-hosted servers on
   older releases fall back to Field Compass only.
6. **ElevenLabs plan.** Zero retention and a regional endpoint are not on
   every plan. Which plan does the operator need for the target users?
7. **Who gets notified.** Proposed: the person who started the run, plus
   the owner for pauses. Should editors be able to follow a survey and get
   all of its notifications?

## Sources

- ElevenLabs speech-to-text API:
  https://elevenlabs.io/docs/api-reference/speech-to-text/convert
- Scribe v2 listing (price, languages, diarisation; to be confirmed on
  ElevenLabs' pricing page): https://www.llmreference.com/model/scribe-v2
- Kobo supplement API and its user flow: `kobo/apps/subsequences/README.md`
  in https://github.com/kobotoolbox/kpi; schema version in
  `jsapp/js/components/processing/common/constants.ts`; routes in
  `kpi/urls/router_api_v2.py`
- Kobo transcription limits:
  https://support.kobotoolbox.org/transcription-translation.html

## 13. As built

Built on `claude/audio-transcription` (2026-10-03), all five phases at once.
Where the build differs from the draft above, or adds to it:

- **Settings changes do not re-transcribe.** `input_hash` covers the question
  and the recording only. Changing the language or the speaker setting
  applies to new recordings; Survey Settings has **Transcribe now** (recordings
  without a transcript) and **Transcribe all again**, each behind an estimate
  of recordings, minutes and allowance left. Both run straight away as a
  `transcription_rerun` run, without a pull.
- **Language filed in Kobo.** The detected language when Scribe is at least
  80% sure, otherwise the survey's language. An answer given in English on a
  French survey is filed as English (and the language is added to Kobo's
  feature). A transcript already in Kobo is re-sent when its text or its
  language changed and nobody corrected it there.
- **Language picker.** "Detect automatically", then the form's own languages
  (matched from its label columns, e.g. `label::Français (fr)`), then the
  other Scribe v2 languages. Scribe v2 lists 100 languages, not "90+". Form
  languages Scribe does not have are named under the picker.
- **Built-in checks** ("Recording has no speech", "Answer in another
  language") show under their recording in the submission, are kept when a
  pull re-validates, and are counted on the run's Transcripts line ("2
  flagged").
- **Recordings** are played by fetching them through the API with the
  viewer's session (an `<audio>` element cannot send the auth header), on
  "Listen", never preloaded.
- **Filters** for AI review state and transcript state on the submission
  list; counts in the activity panel link to them.
- **Pull failures are no longer silent** (F-13): a page of submissions Kobo
  refuses now fails the pull with the reason in words, instead of returning
  what was read so far as if it were everything.
- **Worker import path.** Celery puts the working directory on the import
  path only while loading the app; worker processes now add the backend
  directory themselves (`services/job_queue.py`), which pulls running in the
  worker needed.
- **Local end-to-end mock**: `docs/ui-ux-review/fixtures/mock_audio_services.py`
  serves a Kobo project with audio questions, recordings, the supplement API
  and an ElevenLabs speech-to-text endpoint.

- **Users' own ElevenLabs keys, chosen per survey** (added after the first
  build, 2026-10-03). An ElevenLabs key is an AI connection of kind
  `transcription`, next to the OpenAI-compatible ones (kind `review`), and a
  survey picks one with `survey_configs.transcription_connection_id` as it
  picks a review provider with `ai_connection_id`. Both kinds are added,
  checked, edited, deleted and assigned to surveys the same way, in Account
  settings › AI integration › Your keys. An ElevenLabs key is checked with
  `GET /v1/user` before it is saved (a key limited to Speech to Text is
  accepted: ElevenLabs recognised it) and refused if ElevenLabs refuses it.
  Calls on it record its `connection_id` in `ai_usage`, so they are not
  counted against the included usage; repeated rejected-key or out-of-credit
  failures pause it, as for review providers. Migration `0008`. This
  replaces §4.7's "operator key only"; keys owned by organisations remain the
  later step.
- **Account settings › AI integration** now opens with "AI in Field
  Compass" (what AI review and transcription do, and what the **included
  usage** is: the free usage on Field Compass's keys, renamed from "free
  allowance" everywhere it is shown), then "Your keys", then "Usage": a
  stacked bar chart (AI reviews or transcription minutes; daily for 30 days
  or monthly for 6 months; all surveys or one; included usage vs your keys,
  from `GET /api/ai/usage/history`) and this month per survey with progress
  bars against the included usage.
- **Its own settings tab.** Transcription is processing rather than a check,
  so it moved from Quality checks to an "Audio transcription" tab in Survey
  settings, shown only when the form has audio questions.
- **Question names.** When a form gives every recording the same label
  ("Record the respondent's answer"), the list shows each question's own name
  and section instead, with "Select all" / "Clear".
- **ElevenLabs errors** are read from their current `type` and `code` fields
  as well as the legacy `status` (e.g. `insufficient_credits`,
  `concurrent_limit_exceeded`, `insufficient_permissions`).

- **Transcripts already in Kobo** (added 2026-10-04; answers open question 2).
  Kobo's data API sends, per submission, `_supplementalDetails` with the
  transcript Kobo shows for each question (`{"transcript": {"value",
  "languageCode"}}`: the one accepted last, typed there, made by Kobo's own
  Google transcription, or sent by us; one awaiting review has
  `pendingReview` and no value). Each pull refreshes it on stored
  submissions without counting it as an edit, and for every audio question
  outside repeats, transcribed by the survey or not:
  - a transcript in Kobo that is not ours is stored with
    `audio_transcripts.source = 'kobo'` (migration `0010`) and the recording
    is **never sent to ElevenLabs**, not by a pull, "Transcribe now" or
    "Transcribe all again"; a queued job for it finds it done;
  - ours as sent stays ours; ours corrected in Kobo becomes Kobo's, marked
    `edited_in_kobo` ("Corrected in Kobo");
  - removed in Kobo: the row goes, and the recording is transcribed here
    again if the survey transcribes that question.
  Kobo's transcripts feed AI review and the built-in checks like ours, cost
  nothing, and are never sent back. Before sending, the Kobo job now also
  reads the supplement when it has not sent a version yet, and sends nothing
  if Kobo already shows a transcript (typed or automatic). Survey settings
  says "N already transcribed in Kobo".
- **Recordings in their place.** The submission panel has no separate
  Recordings section: each audio question in Survey Responses shows its
  state ("Transcribed · French · 0:42", "Transcript from Kobo", "Corrected in
  Kobo"), the Listen button in place of the file name, and the transcript,
  findings and Kobo status across the row underneath.

Still to confirm before release: the ElevenLabs plan's zero retention (an
enterprise contract for Scribe v2) and region,
and one manual run against kf.kobotoolbox.org and eu.kobotoolbox.org (the
supplement API was built from Kobo's source, and tested against the mock).

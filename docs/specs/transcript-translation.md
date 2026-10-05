# Design: Translating transcripts

Status: implemented · Builds on [audio-transcription.md](audio-transcription.md)

## 1. Summary

A survey that transcribes audio answers can also have the transcripts
**translated into one language** (usually the analysis language, e.g.
English). Translation uses the survey's **AI provider**, the same one as AI
review, not ElevenLabs. Translations are shown under each transcript in the
submission and, when the survey sends transcripts to Kobo, **sent to Kobo as
Kobo's own translation** of the question. They then appear in Kobo's
processing screen, data table and exports, next to the transcript.

## 2. Decisions

| Question | Decision |
|---|---|
| How many target languages | One per survey (`audio_transcription.translate_to`, ISO 639-3). |
| When | Automatically: right after each transcript is made, and on each pull for transcripts already there (including Kobo's own). "Translate now" and "Translate all again" in Survey Settings for the rest. |
| Who pays | The survey's own AI provider when it has one (no Field Compass limit). Otherwise the operator's key, within the **included AI reviews**: a translated submission counts as one review, and a submission reviewed *and* translated counts once. |
| What AI review reads | The original transcript, unchanged. Translation is for people and Kobo. |
| Which transcripts | Finished transcripts of the questions chosen for transcription, ours or Kobo's. An answer already in the target language, or with no speech, is skipped. |

## 3. Data

`transcript_translations`: one row per transcript (`transcript_id` unique,
deleted with it).

- `language`: the target (ISO 639-3). `input_hash` covers the transcript text
  and the language, so a new text (transcribed again, corrected in Kobo) or
  another language translates again.
- `status`: `pending | running | success | failed | skipped |
  not_run_allowance | cancelled`; `skip_reason`: `same_language | no_speech`.
- `run_id`: the run that queued it. A translation queued by a transcription
  joins that transcription's run, so the run finishes once it is translated.
- `kobo_status`, `kobo_version_uuid`, `kobo_language`, … as for transcripts.

Calls are recorded in `ai_usage` with feature `translation` and the
submission's id.

## 4. Flow

1. **Queueing** (`services/translation_queue.py`, `TranslationQueuer`):
   called after a transcription succeeds, for every fetched submission during
   a pull, and by `POST /api/surveys/{id}/translations/run?mode=missing|all`.
   Failures that can pass (timeouts, rate limits, the allowance) are retried
   on the next pull; a refusal (`bad_request`) is not.
2. **Translating** (`services/translation_runtime.py`, Celery task on the
   `qualitative_checks` queue): `AIService.translate_transcript` asks for
   `{"translation": "…"}`. The prompt names the question, the source and
   target languages, and treats the transcript as data, never instructions.
   The operator model is `OPENAI_TRANSLATION_MODEL` (default: the review
   model) at `OPENAI_TRANSLATION_REASONING_EFFORT` (default `low`).
3. **Sending to Kobo** (`services/kobo_sync_worker.py`): Kobo files a
   translation against the question's transcript and refuses one without
   (`400 No transcription found`). So a translation is sent only once Kobo
   shows the very text it was made from: Kobo's own transcript, or ours with
   `kobo_status = sent`. Sending a transcript queues its translation as soon
   as it lands.

   ```
   POST  /api/v2/assets/{uid}/advanced-features/
         {"question_xpath": "q", "action": "manual_translation", "params": [{"language": "en"}]}
   PATCH /api/v2/assets/{uid}/data/{root_uuid}/supplement/
         {"_version": "20250820", "q": {"manual_translation": {"language": "en", "value": "…"}}}
   ```

   Kobo files translations per language
   (`q.manual_translation.en._versions`). As for transcripts, a translation
   corrected in Kobo, or one Kobo made itself (`automatic_google_translation`),
   is never overwritten: it is marked `edited_in_kobo`.

## 5. What people see

- **Survey Settings › Audio transcription**: "Translate transcripts into"
  (Don't translate, or any language), who translates and what is left of the
  included AI reviews, counts (translated, in progress, failed, not yet
  translated), translations in Kobo, **Translate N now**, **Translate all
  again**. "Send N to Kobo" also sends translations whose transcript Kobo
  shows.
- **Submission**: under each transcript, its translation, or why there is
  none yet, and whether it is in Kobo.
- **Runs**: a "Translations" step with progress, and problems in words
  (rejected key, no credit, no provider, allowance used).

## 6. Not done (yet)

- Several target languages per survey.
- Reading translations typed in Kobo back into Field Compass (they are kept
  in Kobo, and ours is marked "corrected in Kobo").
- Translating speaker turns one by one: the whole transcript is translated
  as one text.

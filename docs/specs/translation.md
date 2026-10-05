# Design: Translating answers

Status: implemented · Related: [audio-transcription.md](audio-transcription.md),
[ai-provider-overhaul.md](ai-provider-overhaul.md)

## 1. Summary

A survey can have answers **translated into one language** (usually the
analysis language, e.g. English) by AI: typed answers to the **text
questions** its owner picks, and the **transcripts** of the audio questions
it picks. Translation is its own feature, next to AI review and audio
transcription:

- its own tab in **Survey Settings › Translation**;
- its own **AI key per survey** (an OpenAI-compatible key, chosen apart from
  AI review's), or Field Compass's within its own **included translations**;
- translations Kobo already has are **read on pull and kept**, never sent to
  the AI again;
- translated transcripts can be **sent to Kobo** as Kobo's translation of the
  question. Kobo keeps translations only for transcribed questions, so
  translations of typed answers stay in Field Compass.

## 2. Decisions

| Question | Decision |
|---|---|
| Target languages | One per survey (`config_data.translation.language`, ISO 639-3). |
| Which answers | The questions the owner ticks: text questions, and audio questions (their transcript, ours or Kobo's). Repeats are not translated yet. |
| When | Automatically: on each pull for every fetched submission, and right after each transcript is made. "Translate now" and "Translate all again" for the rest. |
| Key | `survey_configs.translation_connection_id`: one of the owner's OpenAI-compatible keys, picked per survey in Account settings › AI integration, separately from AI review's `ai_connection_id`. |
| Included usage | Counted in translated answers per survey per month (`AI_ALLOWANCE_TRANSLATIONS_PER_SURVEY_MONTH`, default 500), on top of and apart from AI reviews. One call that cost credit = one translation. |
| What AI review reads | The original answer, unchanged. |
| Kobo's translations | Read from `_supplementalDetails` on pull. A translation Kobo shows in the survey's language is stored (origin `kobo`) and never translated here. |

## 3. Data

`answer_translations`: one row per (submission, question).

- `source`: `text` (a typed answer) or `transcript` (with `transcript_id`,
  deleted with the transcript).
- `origin`: `ai` (translated here) or `kobo` (Kobo's, read on pull).
- `language`: the target. `input_hash` covers the text and the language, so
  an edited answer, a transcript made again or corrected in Kobo, or another
  language translates again.
- `status`: `pending | running | success | failed | skipped |
  not_run_allowance | cancelled`; `skip_reason`: `same_language | no_text`.
- `run_id`: the run that queued it. One queued by a transcription joins that
  transcription's run.
- `kobo_status`, `kobo_version_uuid`, `kobo_language`, … as for transcripts.

Calls go to `ai_usage` with feature `translation` and the submission's id.

## 4. Flow

1. **Queueing** (`services/translation_queue.py`, `TranslationQueuer`), from
   the pull, after a transcription, and from
   `POST /api/surveys/{id}/translations/run?mode=missing|all`:
   - an answer with no letters (`-99`, a number) is skipped (`no_text`);
   - a transcript the speech model is sure is already in the language is
     skipped (`same_language`); for typed answers the AI says so
     (`already_in_language`) and the row is skipped after the call;
   - failures that can pass are retried on the next pull; a refusal
     (`bad_request`) is not.
2. **Kobo's translations, on pull.** Kobo's data API lists them per question
   by language code: `{"translation": {"en": {"languageCode": "en", "value":
   "…"}}}`, with `pendingReview` and an empty value while one waits for review.
   - Kobo has one in the survey's language → stored as origin `kobo`; nothing
     is sent to the AI, even by "Translate all again".
   - It is ours as sent (same text) → stays ours.
   - Ours, changed in Kobo → Kobo's stands, marked "corrected in Kobo".
   - Gone from Kobo → the row is removed and the answer translated here again.
   - Waiting for review, or in another language only → not counted.
   Typed answers have none in Kobo.
3. **Translating** (`services/translation_runtime.py`, Celery task on the
   `qualitative_checks` queue): `AIService.translate_answer` asks for
   `{"already_in_language": bool, "translation": "…"}`. The prompt names the
   question, the languages, whether it is a transcript, and treats the answer
   as data, never instructions. The job re-reads the answer first and stops
   if it changed.
4. **Sending to Kobo** (`services/kobo_sync_worker.py`), for translated
   transcripts when "Send translations of recordings to Kobo" is on and
   sending to Kobo is not paused. Kobo files a translation against the
   question's transcript and refuses one without, so a translation is sent
   only once Kobo shows the very text it was made from. Sending a transcript
   queues its translation as soon as it lands.

   ```
   POST  /api/v2/assets/{uid}/advanced-features/
         {"question_xpath": "q", "action": "manual_translation", "params": [{"language": "en"}]}
   PATCH /api/v2/assets/{uid}/data/{root_uuid}/supplement/
         {"_version": "20250820", "q": {"manual_translation": {"language": "en", "value": "…"}}}
   ```

   A translation corrected in Kobo, or made by Kobo, is never overwritten.

## 5. What people see

- **Survey Settings › Translation**: on/off, language, the text and audio
  questions (audio ones not transcribed here say so), "Send translations of
  recordings to Kobo", who translates and this month's included
  translations, counts (translated, from Kobo, in progress, failed, not yet
  translated), **Translate N now**, **Send N to Kobo**, **Translate all
  again**.
- **Survey Settings › Audio transcription**: "Translate the transcripts", a
  shortcut into the same Translation settings. Ticked, the transcribed
  questions join the translated ones (the language is picked there if none
  is set yet); unticked, they leave and translation stays on for any text
  questions. The summary says whether transcripts are translated, with a
  link to Translation. In Translation, an audio question Field Compass does
  not transcribe says only recordings with a transcript in Kobo will be
  translated, with a link to turn its transcription on.
- **Submission**: under a typed answer or a recording, its translation (or
  why there is none yet). Kobo lines say what they are about: "Transcript in
  Kobo", "Translation in Kobo".
- **Runs**: a "Translations" step, and problems in words.
- **Account settings › AI integration**: three features (AI review,
  Translation, Audio transcription); included usage shows translated answers
  per survey per month; "Your keys" lets an AI model key serve a survey's AI
  review, its translation, or both; usage per survey has a Translation column
  and the chart a Translations view. The admin Usage tab counts translations
  apart from AI reviews.

## 6. Not done (yet)

- Several target languages per survey.
- Questions inside repeat groups.
- Translating speaker turns one by one: a transcript is translated as one text.

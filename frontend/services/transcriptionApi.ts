/**
 * Audio transcription (ElevenLabs Scribe): a survey's settings, starting work,
 * and a submission's transcripts, their translations, and recordings.
 * See docs/specs/audio-transcription.md, part A, and
 * docs/specs/transcript-translation.md.
 */

import { API_BASE_URL, apiFetch } from './apiBase';
import { ApiError, RunSummary } from './activityApi';

export interface AudioQuestion {
  path: string;
  name: string;
  label: string;
  in_repeat: boolean;
}

export interface TranscriptionLanguage {
  /** ISO 639-3, as Scribe names it. */
  code: string;
  name: string;
}

export interface FormLanguage {
  /** As written in the form, e.g. "Français (fr)". */
  label: string;
  /** The Scribe language it matches, or null when Scribe does not list it. */
  code: string | null;
  name: string | null;
}

export interface KoboPause {
  reason: 'permission' | 'unsupported' | string;
  message: string;
  at: string;
}

export interface TranscriptionSettings {
  enabled: boolean;
  questions: string[];
  language: string | null;
  multiple_speakers: boolean;
  send_to_kobo: boolean;
  /** ISO 639-3: transcripts are translated into it by the survey's AI provider. */
  translate_to: string | null;
  acknowledged_at: string | null;
  kobo_pause: KoboPause | null;
}

export interface KoboCounts {
  sent: number;
  edited_in_kobo: number;
  failed: number;
  unsupported: number;
  pending: number;
  unsent: number;
}

export interface TranslationCounts {
  total: number;
  success: number;
  in_progress: number;
  failed: number;
  not_run: number;
  /** Already in the language, or no speech. */
  skipped: number;
  /** Transcripts with no translation in the survey's language yet. */
  missing: number;
  kobo: KoboCounts;
}

/** Who translates: the survey's own AI provider, or Field Compass's within the included AI reviews. */
export interface TranslationProvider {
  available: boolean;
  source: 'own' | 'operator' | null;
  label: string | null;
  model: string | null;
  paused: string | null;
  /** Included AI reviews this month; a translated submission counts as one. Null on the survey's own provider. */
  allowance: { limit: number; remaining: number } | null;
}

export interface TranscriptionOverview {
  /** False when neither the survey's owner nor the server has an ElevenLabs key. */
  available: boolean;
  model: string;
  key: {
    /** "own": the survey's own ElevenLabs key; "operator": Field Compass's, within the included usage. */
    source: 'own' | 'operator' | null;
    /** Why transcription is paused on this key, when it is. */
    paused: string | null;
    /** The name of the survey's own key. */
    label: string | null;
    viewer_is_owner: boolean;
    /** Minutes on the owner's own key this month. */
    own_minutes: number | null;
  };
  settings: TranscriptionSettings;
  translation: TranslationProvider;
  audio_questions: AudioQuestion[];
  form_languages: FormLanguage[];
  languages: TranscriptionLanguage[];
  allowance: {
    month: string;
    limit_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
    max_recording_minutes: number;
  };
  counts: {
    total: number;
    success: number;
    in_progress: number;
    failed: number;
    not_run: number;
    no_speech: number;
    /** Transcripts Kobo already had, typed or made there: never transcribed here. */
    from_kobo: number;
    kobo: KoboCounts;
    /** Null when the survey doesn't translate. */
    translations: TranslationCounts | null;
  };
  can_edit: boolean;
}

export interface TranscriptionSettingsInput {
  enabled: boolean;
  questions: string[];
  language: string | null;
  multiple_speakers: boolean;
  send_to_kobo: boolean;
  translate_to: string | null;
  acknowledge?: boolean;
}

export interface TranscriptionEstimate {
  mode: 'missing' | 'all';
  recordings: number;
  known_minutes: number | null;
  remaining_minutes: number;
}

export interface TranscriptSegment {
  speaker: string | null;
  start: number | null;
  end: number | null;
  text: string;
}

export type KoboStatus = 'not_sent' | 'pending' | 'sent' | 'failed' | 'unsupported' | 'edited_in_kobo';

export interface Translation {
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'not_run_allowance' | 'cancelled';
  skip_reason: 'same_language' | 'no_speech' | null;
  language: string;
  language_name: string | null;
  text: string | null;
  last_error: string | null;
  finished_at: string | null;
  kobo_status: KoboStatus;
  kobo_last_error: string | null;
  kobo_sent_at: string | null;
}

export interface Transcript {
  /** "kobo": the transcript Kobo shows, typed or made there (or ours, corrected there). */
  source: 'elevenlabs' | 'kobo';
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'not_run_allowance' | 'cancelled';
  skip_reason: 'missing_file' | 'too_long' | 'no_speech' | null;
  text: string | null;
  segments: TranscriptSegment[] | null;
  language_code: string | null;
  language_name: string | null;
  language_probability: number | null;
  audio_seconds: number | null;
  last_error: string | null;
  finished_at: string | null;
  kobo_status: KoboStatus;
  kobo_last_error: string | null;
  kobo_sent_at: string | null;
  translation: Translation | null;
}

export interface AudioAnswer {
  question_path: string;
  label: string;
  filename: string | null;
  has_recording: boolean;
  transcribed: boolean;
  transcript: Transcript | null;
}

export interface SubmissionTranscripts {
  enabled: boolean;
  send_to_kobo: boolean;
  expected_language: string | null;
  /** The language transcripts are translated into, when the survey does. */
  translate_to: string | null;
  translate_to_name: string | null;
  answers: AudioAnswer[];
}

const token = () => localStorage.getItem('field_compass_token');

const headers = (): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
});

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(`${API_BASE_URL}${path}`, { ...init, headers: headers() });
  const body = await response.json().catch(() => ({ detail: response.statusText }));
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new ApiError(detail || 'Request failed', response.status, body);
  }
  return body as T;
};

export const getTranscriptionOverview = (surveyId: string) =>
  request<TranscriptionOverview>(`/api/surveys/${surveyId}/audio-transcription`);

export const saveTranscriptionSettings = (surveyId: string, input: TranscriptionSettingsInput) =>
  request<TranscriptionOverview>(`/api/surveys/${surveyId}/audio-transcription`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const estimateTranscription = (surveyId: string, mode: 'missing' | 'all') =>
  request<TranscriptionEstimate>(`/api/surveys/${surveyId}/transcripts/estimate?mode=${mode}`);

/** Transcribe recordings already pulled, now; returns the run to follow. */
export const transcribeNow = (surveyId: string, mode: 'missing' | 'all') =>
  request<RunSummary>(`/api/surveys/${surveyId}/transcripts/run?mode=${mode}`, { method: 'POST' });

/** Translate transcripts already made, now; returns the run to follow. */
export const translateNow = (surveyId: string, mode: 'missing' | 'all') =>
  request<RunSummary>(`/api/surveys/${surveyId}/translations/run?mode=${mode}`, { method: 'POST' });

/** Transcripts not yet in Kobo, and translations whose transcript Kobo shows. */
export const sendTranscriptsToKobo = (surveyId: string) =>
  request<RunSummary>(`/api/surveys/${surveyId}/transcripts/send-to-kobo`, { method: 'POST' });

export const getSubmissionTranscripts = (koboId: number) =>
  request<SubmissionTranscripts>(`/api/submissions/${koboId}/transcripts`);

/**
 * A recording, fetched with the user's session (an <audio> element cannot
 * send the auth header itself). Returns an object URL to revoke when done.
 */
export const loadRecording = async (koboId: number, questionPath: string): Promise<string> => {
  const response = await apiFetch(
    `${API_BASE_URL}/api/submissions/${koboId}/audio?question=${encodeURIComponent(questionPath)}`,
    { headers: token() ? { Authorization: `Bearer ${token()}` } : {} }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not load the recording.');
  }
  return URL.createObjectURL(await response.blob());
};

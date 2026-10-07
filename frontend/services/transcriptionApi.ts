/**
 * Audio transcription (ElevenLabs Scribe): a survey's settings, starting work,
 * and a submission's transcripts and recordings.
 * See docs/specs/audio-transcription.md, part A.
 */

import { API_BASE_URL, apiFetch, authHeaders, request } from './apiBase';
import { RunSummary } from './activityApi';

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
  acknowledged_at: string | null;
  kobo_pause: KoboPause | null;
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
    /** Recordings that cannot be transcribed: the file is missing, or too long. */
    skipped: number;
    no_speech: number;
    /** Transcripts Kobo already had, typed or made there: never transcribed here. */
    from_kobo: number;
    kobo: {
      sent: number;
      edited_in_kobo: number;
      failed: number;
      unsupported: number;
      pending: number;
      unsent: number;
    };
  };
  can_edit: boolean;
}

export interface TranscriptionSettingsInput {
  enabled: boolean;
  questions: string[];
  language: string | null;
  multiple_speakers: boolean;
  send_to_kobo: boolean;
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
  answers: AudioAnswer[];
}

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
    { headers: authHeaders() }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not load the recording.');
  }
  return URL.createObjectURL(await response.blob());
};

/**
 * Translation: a survey's settings, starting work, and a submission's
 * translations. A survey translates the answers to the questions its owner
 * picks -- typed answers, and transcripts of audio questions -- into one
 * language. See docs/specs/translation.md.
 */

import { API_BASE_URL, apiFetch } from './apiBase';
import { ApiError, RunSummary } from './activityApi';
import { KoboPause, KoboStatus, TranscriptionLanguage } from './transcriptionApi';

export interface TranslatableQuestion {
  path: string;
  name: string;
  label: string;
  kind: 'text' | 'audio';
  in_repeat: boolean;
  /** Always true for text; for audio, whether the survey transcribes it (its transcript is what is translated). */
  transcribed: boolean;
}

export interface TranslationSettings {
  enabled: boolean;
  /** ISO 639-3. */
  language: string | null;
  questions: string[];
  /** Translations of transcripts go to Kobo, next to the transcript. */
  send_to_kobo: boolean;
}

export type TranslationSettingsInput = TranslationSettings;

export interface TranslationKobo {
  sent: number;
  edited_in_kobo: number;
  failed: number;
  unsupported: number;
  pending: number;
  unsent: number;
}

export interface TranslationOverview {
  /** False when the survey has no key for translation and the server includes none. */
  available: boolean;
  key: {
    /** "own": the owner's own AI key for translation; "operator": Field Compass's, within the included translations. */
    source: 'own' | 'operator' | null;
    label: string | null;
    model: string | null;
    /** Why translation is paused on the survey's own key, when it is. */
    paused: string | null;
    viewer_is_owner: boolean;
  };
  settings: TranslationSettings;
  questions: TranslatableQuestion[];
  languages: TranscriptionLanguage[];
  /** Included translations this month; null on the survey's own key. */
  allowance: { month: string; limit: number; used: number; in_flight: number; remaining: number } | null;
  /** Sending to Kobo is paused (set by transcription). */
  kobo_pause: KoboPause | null;
  counts: {
    success: number;
    in_progress: number;
    failed: number;
    not_run: number;
    /** Already in the language, or nothing to translate. */
    skipped: number;
    /** Translations Kobo already had: never translated here. */
    from_kobo: number;
    /** Answers with no translation in the survey's language yet. */
    missing: number;
    kobo: TranslationKobo;
  };
  can_edit: boolean;
}

export interface Translation {
  source: 'text' | 'transcript';
  /** "kobo": the translation Kobo shows, typed or made there (or ours, corrected there). */
  origin: 'ai' | 'kobo';
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'not_run_allowance' | 'cancelled';
  skip_reason: 'same_language' | 'no_text' | null;
  language: string;
  language_name: string | null;
  text: string | null;
  last_error: string | null;
  finished_at: string | null;
  kobo_status: KoboStatus;
  kobo_last_error: string | null;
  kobo_sent_at: string | null;
}

export interface SubmissionTranslations {
  enabled: boolean;
  language: string | null;
  language_name: string | null;
  send_to_kobo: boolean;
  /** The question paths the survey translates. */
  questions: string[];
  /** By question path. */
  answers: Record<string, Translation>;
}

const token = () => localStorage.getItem('field_compass_token');

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
  });
  const body = await response.json().catch(() => ({ detail: response.statusText }));
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new ApiError(detail || 'Request failed', response.status, body);
  }
  return body as T;
};

export const getTranslationOverview = (surveyId: string) =>
  request<TranslationOverview>(`/api/surveys/${surveyId}/translation`);

export const saveTranslationSettings = (surveyId: string, input: TranslationSettingsInput) =>
  request<TranslationOverview>(`/api/surveys/${surveyId}/translation`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/** Translate answers already pulled, now; returns the run to follow. */
export const translateNow = (surveyId: string, mode: 'missing' | 'all') =>
  request<RunSummary>(`/api/surveys/${surveyId}/translations/run?mode=${mode}`, { method: 'POST' });

/** Translated transcripts not yet in Kobo, whose transcript Kobo shows. */
export const sendTranslationsToKobo = (surveyId: string) =>
  request<RunSummary>(`/api/surveys/${surveyId}/translations/send-to-kobo`, { method: 'POST' });

export const getSubmissionTranslations = (koboId: number) =>
  request<SubmissionTranslations>(`/api/submissions/${koboId}/translations`);

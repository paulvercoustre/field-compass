/**
 * Translation: a survey's settings, starting work, and a submission's
 * translations. A survey translates the answers to the questions its owner
 * picks -- typed answers, and transcripts of audio questions -- into one
 * language. See docs/specs/translation.md.
 */

import { request } from './apiBase';
import { RunSummary } from './activityApi';
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
  /** Translations the included usage gives a survey a month; 0 when this server includes none. */
  included_per_month: number;
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

/** Whether a survey translates the transcripts of all the questions it transcribes. */
export const translatesTranscripts = (settings: TranslationSettings, transcribed: string[]): boolean =>
  settings.enabled &&
  !!settings.language &&
  transcribed.length > 0 &&
  transcribed.every((path) => settings.questions.includes(path));

/**
 * The translation settings after "Translate the transcripts" is turned on or
 * off from the transcription settings, or null when nothing changes. On: the
 * transcribed questions join the translated ones (and those no longer
 * transcribed leave). Off: the transcribed questions leave; translation stays
 * on for any text questions. Questions picked in Translation are kept.
 */
export const withTranscriptTranslation = (
  current: TranslationSettings,
  change: {
    on: boolean;
    /** Used when translation has no language yet. */
    language: string | null;
    transcribed: string[];
    /** What was transcribed before this save. */
    previouslyTranscribed: string[];
    /** Whether transcripts go to Kobo: their translations follow, when first turned on. */
    sendToKobo: boolean;
  }
): TranslationSettings | null => {
  const dropped = change.previouslyTranscribed.filter((path) => !change.transcribed.includes(path));
  let next: TranslationSettings;
  if (change.on) {
    const questions = [...current.questions.filter((path) => !dropped.includes(path))];
    change.transcribed.forEach((path) => !questions.includes(path) && questions.push(path));
    next = {
      enabled: true,
      language: current.language ?? change.language,
      questions,
      send_to_kobo: current.enabled ? current.send_to_kobo : change.sendToKobo,
    };
  } else {
    if (!translatesTranscripts(current, change.previouslyTranscribed)) return null;
    const leaving = new Set([...change.previouslyTranscribed, ...change.transcribed]);
    const questions = current.questions.filter((path) => !leaving.has(path));
    next = { ...current, questions, enabled: current.enabled && questions.length > 0 };
  }
  const same =
    next.enabled === current.enabled &&
    next.language === current.language &&
    next.send_to_kobo === current.send_to_kobo &&
    next.questions.length === current.questions.length &&
    next.questions.every((path, i) => path === current.questions[i]);
  return same ? null : next;
};

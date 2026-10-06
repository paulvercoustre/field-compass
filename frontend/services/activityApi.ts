/**
 * Background work people can see: runs (a pull and what it started) and
 * in-app notifications. See docs/specs/audio-transcription.md, part B.
 */

import { request } from './apiBase';

export type RunStatus = 'queued' | 'running' | 'background' | 'finished' | 'failed' | 'stopped';
export type RunKind = 'pull' | 'ai_rerun' | 'transcription_rerun' | 'translation_rerun' | 'kobo_resend';

/** Counts for one kind of background work in a run. */
export interface WorkBucket {
  queued: number;
  done: number;
  failed: number;
  not_run: number;
  open: number;
  /** Re-queued by a later pull: counted there instead. */
  handed_off: number;
  eta_seconds?: number | null;
}

export type RunAction =
  | 'open_ai_providers'
  | 'open_ai_usage'
  | 'open_transcription_settings'
  | 'open_kobo_settings'
  | null;

export interface RunProblem {
  kind: string;
  text: string;
  action: RunAction;
}

export interface RunSummary {
  run_id: string;
  survey_id: string;
  survey_name: string | null;
  kind: RunKind;
  status: RunStatus;
  stage: 'queued' | 'fetching' | 'checking' | 'background' | 'done';
  started_by: { user_id: string | null; name: string | null };
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  stop_requested: boolean;
  pull: {
    fetched: number;
    /** Submissions checked so far, while the pull runs. */
    processed: number | null;
    new: number;
    edited: number;
    flagged: number;
    errors: number;
    duration_seconds: number | null;
  } | null;
  ai_checks: WorkBucket | null;
  /** `flagged`: submissions with a finding on a recording (no speech, another language). */
  transcripts: (WorkBucket & { minutes: number; flagged?: number }) | null;
  translations: WorkBucket | null;
  /** Transcripts and translations sent to Kobo, together. */
  kobo: (WorkBucket & { edited_in_kobo: number }) | null;
  problems: RunProblem[];
}

export interface Activity {
  runs: RunSummary[];
  active: boolean;
  unread_notifications: number;
}

export interface NotificationLink {
  view: 'dashboard' | 'settings' | 'userSettings';
  survey_id?: string;
  tab?: string;
  filters?: Record<string, unknown>;
}

export interface AppNotification {
  notification_id: number;
  survey_id: string | null;
  run_id: string | null;
  kind: 'run_finished' | 'run_failed' | 'paused';
  severity: 'info' | 'warning';
  title: string;
  body: string | null;
  link: NotificationLink | null;
  created_at: string | null;
  read: boolean;
}

export const getActivity = () => request<Activity>('/api/activity');

export const getSurveyRuns = (surveyId: string, limit = 10) =>
  request<{ runs: RunSummary[] }>(`/api/surveys/${surveyId}/runs?limit=${limit}`);

export const stopRun = (runId: string) =>
  request<RunSummary>(`/api/runs/${runId}/stop`, { method: 'POST' });

/**
 * Start a pull from Kobo. Resolves with the new run; rejects with an ApiError
 * whose `body.run` is the pull already under way when one is (409).
 */
export const startPull = async (surveyId: string): Promise<RunSummary> => {
  const body = await request<{ data: { run: RunSummary } }>(`/api/etl/run/${surveyId}`, { method: 'POST' });
  return body.data.run;
};

export const getNotifications = () =>
  request<{ notifications: AppNotification[]; unread: number }>('/api/notifications');

/** Mark some notifications read, or all of them when `ids` is omitted. */
export const markNotificationsRead = (ids?: number[]) =>
  request<{ marked: number }>('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify(ids ? { ids } : {}),
  });

export const isOpen = (run: RunSummary) =>
  run.status === 'queued' || run.status === 'running' || run.status === 'background';

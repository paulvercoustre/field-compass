/**
 * A user's own AI providers (OpenAI-compatible endpoints) and which one a
 * survey uses. Keys are sent, never received: responses carry `api_key_hint`.
 */

import { API_BASE_URL, apiFetch } from './apiBase';

export type AIPreset = 'openai' | 'azure' | 'anthropic' | 'openrouter' | 'mistral' | 'groq' | 'self_hosted' | 'custom';
/** What a key is for: AI review and rule writing, or audio transcription. */
export type AIKeyKind = 'review' | 'transcription';
export type TranscriptionPreset = 'elevenlabs';
export type AIConnectionStatus = 'untested' | 'ok' | 'failing';

/** What anyone with access to a survey sees about its provider. */
export interface AIConnectionSummary {
  connection_id: string;
  kind: AIKeyKind;
  label: string;
  preset: AIPreset | TranscriptionPreset;
  host: string | null;
  check_model: string;
  status: AIConnectionStatus;
  last_error: string | null;
}

export interface AIConnectionTest {
  ok: boolean;
  latency_ms?: number;
  category?: string;
  error?: string;
}

export interface AIConnection extends AIConnectionSummary {
  base_url: string;
  api_key_hint: string | null;
  has_api_key: boolean;
  rule_model: string | null;
  capabilities: Record<string, unknown> | null;
  last_tested_at: string | null;
  surveys: Array<{ survey_id: string; survey_name: string }>;
  test?: AIConnectionTest;
}

export interface AIConnectionInput {
  kind?: AIKeyKind;
  label: string;
  preset: AIPreset | TranscriptionPreset;
  /** Review keys only: a transcription key always goes to ElevenLabs. */
  base_url?: string;
  api_key?: string;
  check_model?: string;
  rule_model?: string | null;
}

/** What each kind of key does, in the words the AI integration page uses. */
export const KEY_KINDS: Record<AIKeyKind, { name: string; does: string }> = {
  review: {
    name: 'AI review',
    does: 'Flags weak open-text answers and transcripts, and writes custom checks.',
  },
  transcription: {
    name: 'Audio transcription',
    does: 'Turns recorded answers into text.',
  },
};

export const TRANSCRIPTION_PRESETS: Record<TranscriptionPreset, { name: string; note: string }> = {
  elevenlabs: {
    name: 'ElevenLabs',
    note: 'In ElevenLabs, create a key under Developers › API keys with the Speech to Text permission.',
  },
};

export const providerName = (preset: string): string =>
  (AI_PRESETS as Record<string, { name: string }>)[preset]?.name ??
  (TRANSCRIPTION_PRESETS as Record<string, { name: string }>)[preset]?.name ??
  preset;

export const AI_PRESETS: Record<AIPreset, { name: string; baseUrl: string; modelHint: string; note?: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini' },
  azure: {
    name: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1/',
    modelHint: 'your deployment name',
    note: 'Replace YOUR-RESOURCE with your Azure OpenAI resource name. The model is the deployment name.',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1/',
    modelHint: 'claude-haiku-4-5',
    note: "Uses Anthropic's OpenAI-compatible endpoint with a Claude API key. Use a Claude model name.",
  },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'openai/gpt-4o-mini' },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', modelHint: 'mistral-small-latest' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', modelHint: 'llama-3.3-70b-versatile' },
  self_hosted: {
    name: 'Self-hosted (Ollama, vLLM…)',
    baseUrl: 'http://ollama:11434/v1',
    modelHint: 'llama3.1',
    note: 'Private addresses only work if your administrator has allowed them.',
  },
  custom: { name: 'Other OpenAI-compatible', baseUrl: '', modelHint: 'model name' },
};

const headers = (): HeadersInit => {
  const token = localStorage.getItem('field_compass_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(`${API_BASE_URL}${path}`, { ...init, headers: headers() });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = typeof body.detail === 'string' ? body.detail : response.statusText;
    throw new Error(detail || 'Request failed');
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
};

export const listAIConnections = () => request<AIConnection[]>('/api/ai/connections');

export const createAIConnection = (input: AIConnectionInput) =>
  request<AIConnection>('/api/ai/connections', { method: 'POST', body: JSON.stringify(input) });

/** Omit `api_key` to keep the stored one. */
export const updateAIConnection = (id: string, input: Partial<AIConnectionInput>) =>
  request<AIConnection>(`/api/ai/connections/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const testAIConnection = (id: string) =>
  request<AIConnection>(`/api/ai/connections/${id}/test`, { method: 'POST' });

export const deleteAIConnection = (id: string) =>
  request<void>(`/api/ai/connections/${id}`, { method: 'DELETE' });

/** `null` puts the survey back on included usage (Field Compass's key). */
export const setSurveyAIConnection = (surveyId: string, connectionId: string | null, kind: AIKeyKind = 'review') =>
  request<{ ai_connection: AIConnectionSummary | null }>(`/api/surveys/${surveyId}/ai-connection`, {
    method: 'PUT',
    body: JSON.stringify({ connection_id: connectionId, kind }),
  });

/** Plain words for a stored "<category>: <message>" error or a test result. */
export const describeAIError = (stored: string | null | undefined): string => {
  const [category, ...rest] = (stored ?? '').split(': ');
  const message = rest.join(': ');
  const reasons: Record<string, string> = {
    auth: 'The provider rejected the key.',
    unavailable: 'The provider could not be reached. Try again in a moment.',
    timeout: 'The provider did not answer in time. Try again in a moment.',
    provider_quota: 'The provider account is out of credit.',
    not_configured: 'The stored key can no longer be read. Enter it again.',
  };
  return reasons[category] ?? (message || stored || 'The provider is not responding.');
};

export interface AIFeatureUsage {
  feature: 'qualitative_check' | 'rule_generation' | 'rule_suggestion' | 'transcription';
  calls: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AccountAIUsage {
  month: string; // "2026-10"
  resets_at: string;
  /** What each survey includes on Field Compass's keys; 0 or null when this server includes none. */
  included: {
    reviews_per_survey_month: number;
    transcription_minutes_per_survey_month: number | null;
    rule_requests_per_day: number;
  };
  /** Included AI rule requests on the Field Compass key, today. */
  rule_requests_today: { limit: number; used: number; remaining: number };
  /** Every survey the user owns. */
  surveys: Array<{
    survey_id: string;
    survey_name: string;
    /** Its own provider; null when it uses the Field Compass allowance. */
    provider: AIConnectionSummary | null;
    allowance: { limit: number; used: number; in_flight: number; remaining: number } | null;
    /** Included transcription minutes this month; null when the survey never transcribed. */
    transcription: {
      limit_minutes: number;
      used_minutes: number;
      remaining_minutes: number;
      /** The survey's own transcription key, when it has one: no Field Compass limit. */
      provider: AIConnectionSummary | null;
      own_key_minutes: number;
    } | null;
    by_feature: AIFeatureUsage[];
  }>;
}

/** This month's AI use across the surveys the current user owns. */
export const getAccountAIUsage = () => request<AccountAIUsage>('/api/ai/usage');

export type UsageMetric = 'reviews' | 'minutes';
export type UsagePeriod = '30d' | '6m';

export interface AIUsageHistory {
  metric: UsageMetric;
  period: UsagePeriod;
  unit: 'day' | 'month';
  /** `included`: on Field Compass's keys; `own`: on your own keys. */
  buckets: Array<{ start: string; included: number; own: number }>;
  total_included: number;
  total_own: number;
}

/** AI use over time on the surveys you own: daily for 30 days, or monthly for 6 months. */
export const getAIUsageHistory = (metric: UsageMetric, period: UsagePeriod, surveyId?: string) =>
  request<AIUsageHistory>(
    `/api/ai/usage/history?metric=${metric}&period=${period}${surveyId ? `&survey_id=${surveyId}` : ''}`
  );

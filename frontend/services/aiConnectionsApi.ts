/**
 * A user's own AI providers (OpenAI-compatible endpoints) and which one a
 * survey uses. Keys are sent, never received: responses carry `api_key_hint`.
 */

import { API_BASE_URL } from './apiBase';

export type AIPreset = 'openai' | 'azure' | 'openrouter' | 'mistral' | 'groq' | 'self_hosted' | 'custom';
export type AIConnectionStatus = 'untested' | 'ok' | 'failing';

/** What anyone with access to a survey sees about its provider. */
export interface AIConnectionSummary {
  connection_id: string;
  label: string;
  preset: AIPreset;
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
  label: string;
  preset: AIPreset;
  base_url: string;
  api_key?: string;
  check_model: string;
  rule_model?: string | null;
}

export const AI_PRESETS: Record<AIPreset, { name: string; baseUrl: string; modelHint: string; note?: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini' },
  azure: {
    name: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1/',
    modelHint: 'your deployment name',
    note: 'Replace YOUR-RESOURCE with your Azure OpenAI resource name. The model is the deployment name.',
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
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: headers() });
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

/** `null` puts the survey back on the Field Compass key. */
export const setSurveyAIConnection = (surveyId: string, connectionId: string | null) =>
  request<{ ai_connection: AIConnectionSummary | null }>(`/api/surveys/${surveyId}/ai-connection`, {
    method: 'PUT',
    body: JSON.stringify({ connection_id: connectionId }),
  });

/** Plain words for a stored "<category>: <message>" error or a test result. */
export const describeAIError = (stored: string | null | undefined): string => {
  const [category, ...rest] = (stored ?? '').split(': ');
  const message = rest.join(': ');
  const reasons: Record<string, string> = {
    auth: 'The provider rejected the key.',
    provider_quota: 'The provider account is out of credit.',
    not_configured: 'The stored key can no longer be read. Enter it again.',
  };
  return reasons[category] ?? (message || stored || 'The provider is not responding.');
};

export interface SurveyAIUsage {
  month: string; // "2026-10"
  resets_at: string;
  /** The survey's own provider; null when it uses the Field Compass allowance. */
  provider: AIConnectionSummary | null;
  allowance: { limit: number; used: number; in_flight: number; remaining: number } | null;
  by_feature: Array<{
    feature: 'qualitative_check' | 'rule_generation' | 'rule_suggestion';
    calls: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
  }>;
}

/** This month's AI use for a survey (editors and owners). */
export const getSurveyAIUsage = (surveyId: string) =>
  request<SurveyAIUsage>(`/api/surveys/${surveyId}/ai-usage`);

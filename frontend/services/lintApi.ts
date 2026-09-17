/**
 * Lint and cognitive-pretest API.
 *
 * The linter is deterministic. The pretest may call a model; both operate on
 * form schema only — no respondent answers are sent.
 */

import { API_BASE_URL } from './apiBase';

const authHeaders = (): HeadersInit => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('field_compass_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const data = await response.json().catch(() => ({ detail: fallback }));
  return data.detail || fallback;
};

export interface LintFinding {
  check_id: string;
  severity: 'error' | 'warning' | 'info' | string;
  question_path: string | null;
  message: string;
  why_it_matters: string;
  suggested_fix: string | null;
  auto_rule: Record<string, unknown> | null;
}

export interface LintReport {
  findings: LintFinding[];
  by_severity: Record<string, LintFinding[]>;
  counts: Record<string, number>;
  checks_run: string[];
  checks_failed: string[];
  question_count: number;
  has_audit: boolean | null;
}

export interface PretestFinding {
  check_id: string;
  severity: string;
  question_path: string | null;
  message: string;
  why_it_matters: string;
  profile: string | null;
  source: 'structural' | 'agent' | string;
}

export interface PretestReport {
  findings: PretestFinding[];
  profiles: string[];
  agent_ran: boolean;
  agent_error: string | null;
  question_count: number;
}

export interface AdoptedRule {
  rule_id: string;
  rule_name: string;
  rule_data: Record<string, unknown>;
  is_active: boolean;
  created: boolean;
}

export async function lintForm(form: Record<string, unknown>): Promise<LintReport> {
  const response = await fetch(`${API_BASE_URL}/api/lint`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ form }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not lint this form.'));
  return response.json();
}

export async function lintSurvey(surveyId: string): Promise<LintReport> {
  const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/lint`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not lint this survey.'));
  return response.json();
}

export async function adoptLintRules(
  surveyId: string,
  items: Array<{ check_id: string; question_path: string | null }>,
  isActive = true
): Promise<AdoptedRule[]> {
  const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/lint/adopt-rules`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items, is_active: isActive }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not add those quality checks.'));
  return response.json();
}

export async function pretestForm(
  form: Record<string, unknown>,
  useAgent = true
): Promise<PretestReport> {
  const response = await fetch(`${API_BASE_URL}/api/pretest`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ form, use_agent: useAgent }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not pretest this form.'));
  return response.json();
}

export async function pretestSurvey(surveyId: string, useAgent = true): Promise<PretestReport> {
  const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/pretest`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ use_agent: useAgent }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not pretest this survey.'));
  return response.json();
}

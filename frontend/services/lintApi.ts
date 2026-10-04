/**
 * Form check API.
 *
 * Every check is deterministic and reads the form schema only — no respondent
 * answers are sent, and no model is called.
 */

import { API_BASE_URL, apiFetch } from './apiBase';

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
  /** Short headline: the problem in a few words. */
  message: string;
  /** Specifics behind the headline: codes, question names, counts. */
  details: string | null;
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
  /** The stored form has no constraints or skip logic, so checks that read them were skipped. */
  form_logic_missing?: boolean;
}

export interface AdoptedRule {
  rule_id: string;
  rule_name: string;
  rule_data: Record<string, unknown>;
  is_active: boolean;
  created: boolean;
}

/**
 * `labelColumn` is the survey's label language as a sheet column
 * (`label::French (fr)`); findings quote question labels in it.
 */
export async function lintForm(
  form: Record<string, unknown>,
  labelColumn?: string | null
): Promise<LintReport> {
  const response = await apiFetch(`${API_BASE_URL}/api/lint`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ form, label_column: labelColumn || null }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not lint this form.'));
  return response.json();
}

export async function lintSurvey(surveyId: string, labelColumn?: string | null): Promise<LintReport> {
  const query = labelColumn ? `?label_column=${encodeURIComponent(labelColumn)}` : '';
  const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/lint${query}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not lint this survey.'));
  return response.json();
}

export async function adoptLintRules(
  surveyId: string,
  items: Array<{ check_id: string; question_path: string | null }>,
  isActive = true,
  labelColumn?: string | null
): Promise<AdoptedRule[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/lint/adopt-rules`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items, is_active: isActive, label_column: labelColumn || null }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Could not add those quality checks.'));
  return response.json();
}

export interface DkValue {
  /** The stored code: what submissions carry and what the DK rate compares. */
  name: string;
  label: string;
  /** Choice lists that offer it. */
  lists: string[];
}

/**
 * The form's don't-know codes, found by the same rules the form check uses.
 *
 * Both survey screens pre-fill "Don't know — answer options" from this. The
 * backend builds it from the same function the form check uses, so every
 * don't-know code the check sees is pre-selected, and nothing else is.
 */
export async function findDkValues(
  survey: Array<Record<string, unknown>>,
  choices: Array<Record<string, unknown>>
): Promise<DkValue[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/lint/dk-values`, {
    method: 'POST',
    headers: authHeaders(),
    // The survey rows matter: only lists a question uses are read, exactly
    // as the form check reads them.
    body: JSON.stringify({ form: { survey, choices } }),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not find the form's don't-know options."));
  const body = await response.json();
  return body.values || [];
}

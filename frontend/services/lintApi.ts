/**
 * Form check API.
 *
 * Every check is deterministic and reads the form schema only — no respondent
 * answers are sent, and no model is called.
 */

import { orMessage, request } from './apiBase';

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

interface AdoptedRule {
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
  return orMessage(
    request<LintReport>('/api/lint', {
      method: 'POST',
      body: JSON.stringify({ form, label_column: labelColumn || null }),
    }),
    'Could not lint this form.'
  );
}

export async function lintSurvey(surveyId: string, labelColumn?: string | null): Promise<LintReport> {
  const query = labelColumn ? `?label_column=${encodeURIComponent(labelColumn)}` : '';
  return orMessage(request<LintReport>(`/api/surveys/${surveyId}/lint${query}`), 'Could not lint this survey.');
}

export async function adoptLintRules(
  surveyId: string,
  items: Array<{ check_id: string; question_path: string | null }>,
  isActive = true,
  labelColumn?: string | null
): Promise<AdoptedRule[]> {
  return orMessage(
    request<AdoptedRule[]>(`/api/surveys/${surveyId}/lint/adopt-rules`, {
      method: 'POST',
      body: JSON.stringify({ items, is_active: isActive, label_column: labelColumn || null }),
    }),
    'Could not add those quality checks.'
  );
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
  const body = await orMessage(
    request<{ values?: DkValue[] }>('/api/lint/dk-values', {
      method: 'POST',
      // The survey rows matter: only lists a question uses are read, exactly
      // as the form check reads them.
      body: JSON.stringify({ form: { survey, choices } }),
    }),
    "Could not find the form's don't-know options."
  );
  return body.values || [];
}

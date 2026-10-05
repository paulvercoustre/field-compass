/**
 * AI rule writing: from a description, or suggested from the survey's form.
 */

import { StagedRule } from '../types';

import { request } from './apiBase';

type GeneratedRule = Omit<StagedRule, 'id'>;

/** The fields a staged rule keeps from what the AI wrote; the caller adds the id. */
const toStagedRule = (rule: GeneratedRule): GeneratedRule => ({
  description: rule.description,
  issue_message: rule.issue_message,
  conditions: rule.conditions,
  roster_name: rule.roster_name || null,
});

/** A validation rule written from a plain-language description. */
export async function generateRuleFromNaturalLanguage(surveyId: string, prompt: string): Promise<GeneratedRule> {
  const rule = await request<GeneratedRule>('/api/ai/generate-rule', {
    method: 'POST',
    body: JSON.stringify({ survey_id: surveyId, prompt: prompt.trim() }),
  });
  return toStagedRule(rule);
}

/** Validation rules the AI suggests from the survey's form. */
export async function getSuggestedRules(surveyId: string): Promise<GeneratedRule[]> {
  const rules = await request<GeneratedRule[]>('/api/ai/suggest-rules', {
    method: 'POST',
    body: JSON.stringify({ survey_id: surveyId }),
  });
  return rules.map(toStagedRule);
}

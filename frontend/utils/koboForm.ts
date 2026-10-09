import { KoboProjectForm } from '../services/api';
import { KoboToolData } from '../types';
import { reconstructKoboToolData } from './koboDataUtils';
import { labelColumnFor } from './koboUrl';

/**
 * A form fetched from Kobo, ready to save: the rows come as a survey stores
 * them (backend/services/kobo_form.py), and each pull keeps them in step.
 * The variable list is built the same way a saved tool is rebuilt on load, so
 * the count shown after a refresh matches the one shown after Save.
 */
export function projectFormToKoboTool(form: KoboProjectForm, language: string): KoboToolData {
  return {
    ...reconstructKoboToolData(form.survey, form.choices, labelColumnFor(language)),
    has_audit: form.has_audit,
  };
}

export function koboToolPayload(tool: KoboToolData | null): Record<string, unknown> | null {
  if (!tool) return null;
  return { survey: tool.survey, choices: tool.choices, has_audit: tool.has_audit ?? null };
}

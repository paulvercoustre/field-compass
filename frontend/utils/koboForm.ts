import { KoboProjectForm } from '../services/api';
import { KoboToolData } from '../types';
import { reconstructKoboToolData } from './koboDataUtils';
import { labelColumnFor } from './koboUrl';

/**
 * Persist a form fetched from Kobo in the same sheet-row shape an uploaded
 * XLSForm produces, including the columns the linter reads (constraint,
 * relevant, required, calculation, and the enclosing groups' path and
 * conditions — group rows themselves are not stored).
 */
export function projectFormToKoboTool(form: KoboProjectForm, language: string): KoboToolData {
  const labelColumns = (labels: Record<string, string>) =>
    Object.fromEntries(Object.entries(labels).map(([lang, text]) => [labelColumnFor(lang), text]));

  const survey = form.questions.map((q) => ({
    type: q.type,
    name: q.name,
    ...labelColumns(q.labels),
    roster_name: q.repeat_name,
    list_name: q.list_name,
    required: q.required ? 'yes' : undefined,
    constraint: q.constraint || undefined,
    relevant: q.relevant || undefined,
    calculation: q.calculation || undefined,
    choice_filter: q.choice_filter || undefined,
    group_path: q.group_path || undefined,
    group_relevant: q.group_relevant?.length ? q.group_relevant : undefined,
  }));

  const choices = Object.entries(form.choice_lists).flatMap(([list_name, options]) =>
    options.map((option) => ({
      list_name,
      name: option.name,
      ...labelColumns(option.labels),
    }))
  );

  // Build the variable list the same way a saved tool is rebuilt on load, so
  // the count shown after a refresh matches the one shown after Save. Every
  // question is kept in `survey`; only answerable types become variables.
  const { variableMap } = reconstructKoboToolData(survey, choices, labelColumnFor(language));

  return { survey, choices, variableMap, has_audit: form.has_audit } as KoboToolData;
}

export function koboToolPayload(tool: KoboToolData | null): Record<string, unknown> | null {
  if (!tool) return null;
  return { survey: tool.survey, choices: tool.choices, has_audit: tool.has_audit ?? null };
}

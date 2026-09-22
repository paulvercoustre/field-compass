import { KoboProjectForm } from '../services/api';
import { KoboToolData, KoboVariable } from '../types';
import { labelColumnFor } from './koboUrl';

/**
 * Persist a form fetched from Kobo in the same sheet-row shape an uploaded
 * XLSForm produces, including the columns the linter reads (constraint,
 * relevant, required, calculation, and the enclosing groups' path and
 * conditions — group rows themselves are not stored).
 */
export function projectFormToKoboTool(
  form: KoboProjectForm,
  language: string
): KoboToolData {
  const labelColumns = (labels: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(labels).map(([lang, text]) => [labelColumnFor(lang), text])
    );

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

  const variableMap = new Map<string, KoboVariable>(
    form.questions.map((q) => [
      q.name,
      {
        type: q.type,
        label: q.labels[language] || q.name,
        choiceListName: q.list_name,
        roster_name: q.repeat_name,
      },
    ])
  );

  return { survey, choices, variableMap } as KoboToolData;
}

export function koboToolPayload(tool: KoboToolData | null): Record<string, unknown> | null {
  if (!tool) return null;
  return { survey: tool.survey, choices: tool.choices };
}

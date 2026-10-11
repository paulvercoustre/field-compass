import { KoboQuestion, KoboChoice } from '../types';
import type { SurveyConfig } from '../services/progressApi';
import { formText } from './formText';
import { findAnswer } from './answers';
import { NO_ENUMERATOR } from './filterUtils';

const ENGLISH = 'label::English (en)';

type LabelledRow = Record<string, unknown>;

/** A form's label columns (`label::<language>`), in the order they first appear. */
export const formLabelColumns = (rows: readonly unknown[]): string[] =>
  Array.from(
    new Set((rows as LabelledRow[]).flatMap((row) => Object.keys(row).filter((k) => k.startsWith('label::'))))
  );

/**
 * The column every screen reads labels from: the language chosen in
 * Settings › Form. Until one is saved, English when the form has it, else the
 * form's first language, which is what that setting then shows as chosen.
 */
export const labelColumnOf = (
  tool:
    | { survey?: readonly unknown[]; choices?: readonly unknown[]; label_column_survey?: string | null }
    | null
    | undefined
): string => {
  if (tool?.label_column_survey) return tool.label_column_survey;
  const columns = formLabelColumns([...(tool?.survey ?? []), ...(tool?.choices ?? [])]);
  // A form without translations has a plain `label`, which labelIn reads anyway.
  return columns.length === 0 || columns.includes(ENGLISH) ? ENGLISH : columns[0];
};

/** A row's label in that column; else in any language it has; else `fallback`. */
export const labelIn = (row: object, column: string, fallback: string): string => {
  const cells = row as LabelledRow;
  const text =
    cells[column] ??
    cells.label ??
    Object.entries(cells).find(([key, value]) => key.startsWith('label::') && typeof value === 'string' && value)?.[1];
  return typeof text === 'string' && text.trim() ? text : fallback;
};

/**
 * Get the label for a question variable from Kobo survey data
 */
export const getQuestionLabel = (
  variableName: string,
  surveyConfig: SurveyConfig | null,
  labelColumn?: string
): string => {
  if (!surveyConfig?.config_data.kobo_tool) {
    return variableName;
  }

  const labelCol = labelColumn || labelColumnOf(surveyConfig.config_data.kobo_tool);
  const survey = surveyConfig.config_data.kobo_tool.survey || [];

  const question = survey.find((q: KoboQuestion) => q.name === variableName);
  if (!question) {
    return variableName;
  }

  return labelIn(question, labelCol, question.name || variableName);
};

/**
 * Get the label for a choice value from Kobo choices data
 */
export const getChoiceLabel = (
  choiceValue: string,
  listName: string | null,
  surveyConfig: SurveyConfig | null,
  labelColumn?: string
): string => {
  if (!listName || !surveyConfig?.config_data.kobo_tool) {
    return choiceValue;
  }

  const tool = surveyConfig.config_data.kobo_tool;
  const labelCol = labelColumn || tool.label_column_choices || labelColumnOf(tool);
  const choices = tool.choices || [];

  const choice = choices.find((c: KoboChoice) => c.list_name === listName && c.name === choiceValue);
  if (!choice) {
    return choiceValue;
  }

  return labelIn(choice, labelCol, choice.name || choiceValue);
};

/**
 * A choice list's options, in the form's order: name, label, and the whole
 * stored row, whose other columns are what a choice filter tests.
 */
export const getChoices = (
  listName: string | null | undefined,
  surveyConfig: SurveyConfig | null
): Array<{ name: string; label: string; row: Record<string, unknown> }> => {
  const tool = surveyConfig?.config_data.kobo_tool;
  if (!listName || !tool) return [];
  const labelCol = tool.label_column_choices || labelColumnOf(tool);
  return (tool.choices || [])
    .filter((c: KoboChoice) => c.list_name === listName)
    .map((c: KoboChoice) => ({
      name: String(c.name),
      label: labelIn(c, labelCol, String(c.name)),
      row: c as unknown as Record<string, unknown>,
    }));
};

/**
 * Get the question type and list name for a variable
 */
export const getQuestionInfo = (
  variableName: string,
  surveyConfig: SurveyConfig | null
): { type: string; listName: string | null } | null => {
  if (!surveyConfig?.config_data.kobo_tool) {
    return null;
  }

  const survey = surveyConfig.config_data.kobo_tool.survey || [];
  const question = survey.find((q: KoboQuestion) => q.name === variableName);

  if (!question) {
    return null;
  }

  return {
    type: question.type || '',
    listName: question.list_name || null,
  };
};

/**
 * Format a value for display, converting choice values to labels when appropriate
 */
export const formatValueForDisplay = (value: any, variableName: string, surveyConfig: SurveyConfig | null): string => {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }

  // Get question info to determine if this is a select question
  const questionInfo = getQuestionInfo(variableName, surveyConfig);

  if (!questionInfo) {
    // Not a known question, just return the value as string
    return String(value);
  }

  const { type, listName } = questionInfo;

  // Handle select_one questions
  if (type === 'select_one' && listName) {
    return getChoiceLabel(String(value), listName, surveyConfig);
  }

  // Handle select_multiple questions (values are space-separated)
  if (type === 'select_multiple' && listName) {
    const values = String(value).split(' ');
    const labels = values.map((v) => getChoiceLabel(v, listName, surveyConfig));
    return labels.join(', ');
  }

  // For other types (integer, decimal, text, date, etc.), return as-is
  return String(value);
};

/**
 * A question's label as plain text: references filled from the submission's
 * answers when there is one (otherwise shown as "…"), markdown dropped.
 */
export const questionText = (
  variableName: string,
  surveyConfig: SurveyConfig | null,
  data?: Record<string, unknown> | null
): string =>
  formText(
    getQuestionLabel(variableName, surveyConfig),
    data
      ? (question) => {
          const value = findAnswer(data, question);
          return value === undefined || value === null || value === ''
            ? undefined
            : formatValueForDisplay(value, question, surveyConfig);
        }
      : undefined
  );

/** An enumerator as the queue's filter shows it: the answer's label, or "No enumerator recorded". */
export const enumeratorLabel = (value: string, surveyConfig: SurveyConfig | null): string => {
  if (value === NO_ENUMERATOR) return 'No enumerator recorded';
  const field = surveyConfig?.config_data?.core_identifiers?.enumerator;
  return field ? formatValueForDisplay(value, field, surveyConfig) : value;
};

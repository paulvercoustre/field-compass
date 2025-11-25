import { KoboQuestion, KoboChoice, SurveyConfig } from '../types';

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

  const labelCol = labelColumn || surveyConfig.config_data.kobo_tool.label_column_survey || 'label::English (en)';
  const survey = surveyConfig.config_data.kobo_tool.survey || [];
  
  const question = survey.find((q: KoboQuestion) => q.name === variableName);
  if (!question) {
    return variableName;
  }

  // Try the specified label column, fallback to default, then to variable name
  return (question as any)[labelCol] || question['label::English (en)'] || question.name || variableName;
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

  const labelCol = labelColumn || surveyConfig.config_data.kobo_tool.label_column_choices || 'label::English (en)';
  const choices = surveyConfig.config_data.kobo_tool.choices || [];
  
  const choice = choices.find((c: KoboChoice) => c.list_name === listName && c.name === choiceValue);
  if (!choice) {
    return choiceValue;
  }

  // Try the specified label column, fallback to default, then to choice name
  return (choice as any)[labelCol] || choice['label::English (en)'] || choice.name || choiceValue;
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
export const formatValueForDisplay = (
  value: any,
  variableName: string,
  surveyConfig: SurveyConfig | null
): string => {
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
    const labels = values.map(v => getChoiceLabel(v, listName, surveyConfig));
    return labels.join(', ');
  }

  // For other types (integer, decimal, text, date, etc.), return as-is
  return String(value);
};


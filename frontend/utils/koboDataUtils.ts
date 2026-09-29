import { KoboToolData, KoboQuestion, KoboVariable } from '../types';

/**
 * Reconstructs KoboToolData from stored survey and choices data
 * This rebuilds the variableMap which can't be serialized to JSON
 */
export const reconstructKoboToolData = (
  survey: KoboQuestion[],
  choices: any[],
  labelColumnSurvey?: string
): KoboToolData => {
  // Keep every stored row — including audit/start/today — so a later save does
  // not strip the fields the linter and duration checks need. The picker map
  // still only includes answerable types.
  const pickerTypes = ['select_one', 'select_multiple', 'integer', 'decimal', 'calculate', 'text', 'date', 'datetime'];
  const pickerRows = survey.filter(q => {
    const qType = q.type || '';
    return pickerTypes.some(t => qType.startsWith(t));
  });

  const labelCol = labelColumnSurvey || 'label::English (en)';

  const variableMap = new Map<string, KoboVariable>();
  pickerRows.forEach(q => {
    if (q.name) {
      const choiceListName = q.type?.includes('select_') ? q.list_name || null : null;
      const label = (q as any)[labelCol] || q['label::English (en)'] || q.name;
      variableMap.set(q.name, {
        type: q.type || '',
        label: label,
        choiceListName: choiceListName,
        roster_name: q.roster_name || null,
      });
    }
  });

  return {
    survey: survey,
    choices: choices,
    variableMap: variableMap,
  };
};


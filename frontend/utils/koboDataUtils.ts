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
  // Filter to only relevant question types (same logic as parser)
  const relevantTypes = ['select_one', 'select_multiple', 'integer', 'decimal', 'calculate', 'text', 'date', 'datetime'];
  const filteredSurvey = survey.filter(q => {
    const qType = q.type || '';
    return relevantTypes.some(t => qType.startsWith(t));
  });

  // Determine which label column to use
  const labelCol = labelColumnSurvey || 'label::English (en)';

  // Rebuild variableMap
  const variableMap = new Map<string, KoboVariable>();
  filteredSurvey.forEach(q => {
    if (q.name) {
      const choiceListName = q.type?.includes('select_') ? q.list_name || null : null;
      // Use the specified label column, fallback to default, then to name
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
    survey: filteredSurvey,
    choices: choices,
    variableMap: variableMap,
  };
};


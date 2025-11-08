import { KoboToolData, KoboQuestion, KoboVariable } from '../types';

/**
 * Reconstructs KoboToolData from stored survey and choices data
 * This rebuilds the variableMap which can't be serialized to JSON
 */
export const reconstructKoboToolData = (
  survey: KoboQuestion[],
  choices: any[]
): KoboToolData => {
  // Filter to only relevant question types (same logic as parser)
  const relevantTypes = ['select_one', 'select_multiple', 'integer', 'decimal', 'calculate', 'text', 'date', 'datetime'];
  const filteredSurvey = survey.filter(q => {
    const qType = q.type || '';
    return relevantTypes.some(t => qType.startsWith(t));
  });

  // Rebuild variableMap
  const variableMap = new Map<string, KoboVariable>();
  filteredSurvey.forEach(q => {
    if (q.name) {
      const choiceListName = q.type?.includes('select_') ? q.list_name || null : null;
      variableMap.set(q.name, {
        type: q.type || '',
        label: q['label::English (en)'] || q.name,
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


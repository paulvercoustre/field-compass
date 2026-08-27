
import type { KoboToolData, KoboQuestion, KoboChoice, KoboVariable } from '../types';
export type { KoboToolData } from '../types';

import * as XLSX from 'xlsx';

export const parseKoboTool = (file: File): Promise<KoboToolData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
            throw new Error("Failed to read file.");
        }
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const surveySheet = workbook.Sheets['survey'];
        const choicesSheet = workbook.Sheets['choices'];

        if (!surveySheet || !choicesSheet) {
          throw new Error("Excel file must contain both 'survey' and 'choices' sheets.");
        }

        const allQuestions: any[] = XLSX.utils.sheet_to_json(surveySheet);
        const choices: KoboChoice[] = XLSX.utils.sheet_to_json(choicesSheet);
        
        // --- Roster Parsing Logic ---
        let currentRoster: string | null = null;
        const processedQuestions: KoboQuestion[] = [];
        allQuestions.forEach(q => {
            const qType = q.type || '';
            if (qType.startsWith('begin_repeat')) {
                currentRoster = q.name;
            } else if (qType.startsWith('end_repeat')) {
                currentRoster = null;
            } else if (q.name) { // Only process questions with a 'name'
                const [type, list_name] = qType.split(' ');
                processedQuestions.push({
                    ...q,
                    roster_name: currentRoster,
                    type,
                    list_name: list_name || null,
                });
            }
        });

        const relevantTypes = ['select_one', 'select_multiple', 'integer', 'decimal', 'calculate', 'text', 'date', 'datetime'];
        const survey = processedQuestions.filter(q => {
            const qType = q.type || '';
            return relevantTypes.some(t => qType.startsWith(t));
        });

        const variableMap = new Map<string, KoboVariable>();
        survey.forEach(q => {
            if (q.name) {
                const choiceListName = q.type.includes('select_') ? q.list_name : null;
                variableMap.set(q.name, {
                    type: q.type,
                    label: q['label::English (en)'] || q.name,
                    choiceListName: choiceListName || null,
                    roster_name: q.roster_name,
                });
            }
        });

        resolve({ survey, choices, variableMap });

      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = (err) => {
        reject(new Error("FileReader error: " + err));
    };

    reader.readAsArrayBuffer(file);
  });
};
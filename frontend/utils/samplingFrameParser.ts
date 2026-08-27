/**
 * Parse sampling frame file (CSV or XLSX) and return headers and rows
 */
import * as XLSX from 'xlsx';

export const parseSamplingFrame = (file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
          throw new Error("Failed to read file.");
        }

        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

        if (isExcel) {
          // Parse XLSX file
          const data = new Uint8Array(e.target.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get the first sheet
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            throw new Error("Excel file has no sheets.");
          }
          
          const sheet = workbook.Sheets[firstSheetName];
          const jsonData: any[] = XLSX.utils.sheet_to_json(sheet);
          
          if (jsonData.length === 0) {
            throw new Error("Excel file is empty.");
          }
          
          // Extract headers from first row
          const headers = Object.keys(jsonData[0]);
          
          // Convert to rows format
          const rows: Record<string, any>[] = jsonData.map(row => {
            const rowObj: Record<string, any> = {};
            headers.forEach(header => {
              rowObj[header] = row[header];
            });
            return rowObj;
          });
          
          resolve({ headers, rows });
        } else {
          // Parse CSV file
          const text = e.target.result as string;
          const lines = text.split('\n').filter(line => line.trim());
          
          if (lines.length === 0) {
            throw new Error("CSV file is empty.");
          }
          
          // Parse headers - handle quoted values and commas within quotes
          const parseCSVLine = (line: string): string[] => {
            const result: string[] = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            result.push(current.trim());
            return result;
          };
          
          const headers = parseCSVLine(lines[0]);
          
          // Parse rows
          const rows: Record<string, any>[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length === headers.length) {
              const row: Record<string, any> = {};
              headers.forEach((header, index) => {
                row[header] = values[index];
              });
              rows.push(row);
            }
          }
          
          resolve({ headers, rows });
        }
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = (err) => {
      reject(new Error("FileReader error: " + err));
    };

    // Read as ArrayBuffer for XLSX, as text for CSV
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    
    if (isExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
};

/**
 * Common names for target/interview count columns that don't need to match Kobo variables
 */
const TARGET_COLUMN_NAMES = [
  'target',
  'target_interviews',
  'target_interview',
  'target_count',
  'target_number',
  'interviews_target',
  'interview_target',
  'total_target',
  'expected_interviews',
  'expected_count',
  'sample_size',
  'sample_size_target',
];

/**
 * Check if a column name is a target column (doesn't need to match Kobo variables)
 */
export const isTargetColumn = (columnName: string): boolean => {
  const normalized = columnName.toLowerCase().trim();
  return TARGET_COLUMN_NAMES.some(name => normalized === name || normalized.includes(name));
};

/**
 * Validate sampling frame columns against Kobo tool variables
 * Allows one target column that doesn't need to match
 * Now accepts files with unmatched columns but warns about them
 * @returns Object with validation result, matching/unmatched columns, and target column
 */
export const validateSamplingFrameColumns = (
  frameHeaders: string[],
  koboVariables: string[]
): { 
  isValid: boolean; 
  matchingColumns: string[]; 
  unmatchedColumns: string[]; 
  targetColumn: string | null;
  hasUnmatchedColumns: boolean;
} => {
  const matchingColumns: string[] = [];
  const unmatchedColumns: string[] = [];
  let targetColumn: string | null = null;
  
  // Find target column if it exists
  const targetCol = frameHeaders.find(col => isTargetColumn(col));
  if (targetCol) {
    targetColumn = targetCol;
  }
  
  // Categorize all columns (except target column)
  frameHeaders.forEach(header => {
    if (header === targetColumn) {
      // Skip target column - it's handled separately
      return;
    }
    
    if (koboVariables.includes(header)) {
      matchingColumns.push(header);
    } else {
      unmatchedColumns.push(header);
    }
  });
  
  // File is valid as long as we have at least one matching column
  // or if the only column is a target column
  const isValid = matchingColumns.length > 0 || (frameHeaders.length === 1 && targetColumn !== null);
  
  return {
    isValid,
    matchingColumns,
    unmatchedColumns,
    targetColumn,
    hasUnmatchedColumns: unmatchedColumns.length > 0,
  };
};


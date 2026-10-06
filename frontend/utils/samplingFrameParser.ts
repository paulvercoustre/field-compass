type FrameValue = string | number | boolean;
type SamplingFrame = { headers: string[]; rows: Record<string, FrameValue>[] };

const extension = (file: File) => file.name.toLowerCase().split('.').pop() ?? '';

/** FileReader rather than file.text(): it works in every browser and in jsdom. */
function read(file: File, as: 'text'): Promise<string>;
function read(file: File, as: 'buffer'): Promise<ArrayBuffer>;
function read(file: File, as: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

/** A cell as the frame keeps it: dates as YYYY-MM-DD, empty as "". */
const cellValue = (cell: unknown): FrameValue => {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return cell;
  return String(cell);
};

/**
 * Headers from the first row, then one object per non-empty row with every
 * header as a key (readers find columns from the first row's keys).
 */
const toFrame = (table: unknown[][], kind: string): SamplingFrame => {
  const [first, ...rest] = table;
  const headers = (first ?? []).map((cell) => String(cell ?? '').trim());
  if (!headers.some(Boolean)) throw new Error(`${kind} file is empty.`);
  const rows = rest
    .map((cells) => {
      const row: Record<string, FrameValue> = {};
      headers.forEach((header, index) => {
        if (header) row[header] = cellValue(cells[index]);
      });
      return row;
    })
    .filter((row) => Object.values(row).some((value) => value !== ''));
  return { headers: headers.filter(Boolean), rows };
};

/** One CSV line into cells: commas inside double quotes stay in the cell. */
const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
};

/**
 * Parse a sampling frame (CSV or .xlsx) into its headers and rows.
 *
 * The spreadsheet reader only loads when a spreadsheet is chosen, not with the
 * app. Old binary Excel files (.xls) cannot be read: they are asked for again
 * as .xlsx or CSV.
 */
export const parseSamplingFrame = async (file: File): Promise<SamplingFrame> => {
  const kind = extension(file);
  if (kind === 'xls') {
    throw new Error('Old Excel files (.xls) cannot be read. Save it as .xlsx or CSV and upload it again.');
  }
  if (kind === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return toFrame(await readSheet(await read(file, 'buffer')), 'Excel');
  }
  const lines = (await read(file, 'text')).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) throw new Error('CSV file is empty.');
  const [header, ...body] = lines.map(parseCsvLine);
  // A row with a different number of cells than the header is malformed and skipped.
  return toFrame([header, ...body.filter((cells) => cells.length === header.length)], 'CSV');
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


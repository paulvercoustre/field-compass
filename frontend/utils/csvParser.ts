/**
 * Parse CSV file and return headers and rows
 */
export const parseCSV = (file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
          throw new Error("Failed to read file.");
        }
        
        const text = e.target.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          throw new Error("CSV file is empty.");
        }
        
        // Parse headers
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        
        // Parse rows
        const rows: Record<string, any>[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          if (values.length === headers.length) {
            const row: Record<string, any> = {};
            headers.forEach((header, index) => {
              row[header] = values[index];
            });
            rows.push(row);
          }
        }
        
        resolve({ headers, rows });
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = (err) => {
      reject(new Error("FileReader error: " + err));
    };
    
    reader.readAsText(file);
  });
};



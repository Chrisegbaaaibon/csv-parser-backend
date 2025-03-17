// src/utils/csv-parser.ts
import * as XLSX from 'xlsx';

export interface PropertyUnit {
  [key: string]: any;
}

export interface ParseResult {
  data: PropertyUnit[];
  fields: string[];
  detectedFields: {
    [key: string]: {
      type: string;
      label: string;
      example: any;
    };
  };
}

export async function parseCSV(csvString: string): Promise<ParseResult> {
  console.log('CSV parsing started');

  try {
    // Clean the CSV string and split into rows
    const rows = csvString.trim().split(/\r?\n/);

    if (rows.length === 0) {
      console.warn('CSV file is empty');
      return { data: [], fields: [], detectedFields: {} };
    }

    // Try to detect the delimiter
    const firstRow = rows[0];
    const possibleDelimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ',';
    let maxFields = 0;

    possibleDelimiters.forEach((delimiter) => {
      const count = firstRow.split(delimiter).length;
      if (count > maxFields) {
        maxFields = count;
        bestDelimiter = delimiter;
      }
    });

    console.log(`Using delimiter: "${bestDelimiter}"`);

    // Extract headers from the first row
    const headers = rows[0].split(bestDelimiter).map((h) => {
      // Clean up headers - trim and handle quoted values
      const cleaned = h.trim().replace(/^["'](.+)["']$/, '$1');
      return cleaned || `Column${Math.random().toString(36).substring(2, 7)}`;
    });

    console.log('Headers found:', headers);

    // Parse the data rows
    const data: PropertyUnit[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].trim();
      if (!row) continue; // Skip empty rows

      const values = row.split(bestDelimiter);

      // Skip rows that have any empty values
      const hasEmptyValues = values.some((val, idx) => {
        // Only check emptiness for columns that have headers
        if (idx >= headers.length) return false;
        return val.trim() === '';
      });

      if (hasEmptyValues) {
        console.log(`Skipping row ${i} because it has empty values`);
        continue;
      }

      const item: PropertyUnit = {};

      headers.forEach((header, index) => {
        let value = index < values.length ? values[index].trim() : '';

        // Remove quotes if present
        value = value.replace(/^["'](.+)["']$/, '$1');

        // Store the value as-is, without transformation
        item[header] = value;
      });

      // Add the row data
      data.push(item);
    }

    console.log(`Parsed ${data.length} data rows after filtering empty rows`);

    // Detect field types
    const detectedFields: Record<
      string,
      { type: string; label: string; example: any }
    > = {};

    headers.forEach((header) => {
      // Find a non-empty example
      let example: null | string | number = null;
      let type = 'string';

      for (const item of data) {
        const value = item[header];
        if (value !== undefined && value !== null && value !== '') {
          example = value;

          // Simple type detection
          if (!isNaN(Number(value)) && value !== '') {
            type = 'number';
            example = Number(value);
          }
          break;
        }
      }

      detectedFields[header] = {
        type,
        label: header,
        example,
      };
    });

    return {
      data,
      fields: headers,
      detectedFields,
    };
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw new Error(
      `Failed to parse CSV: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function parseExcel(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);

        // Try parsing with different options to find the best approach
        const workbook = XLSX.read(data, {
          type: 'array',
          cellDates: true, // Properly handle dates
          cellText: false, // Don't convert to text unnecessarily
        });

        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        console.log(`Reading sheet: ${firstSheetName}`);

        const worksheet = workbook.Sheets[firstSheetName];

        // Try to determine if headers are on the first or second row
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z1');
        console.log('Worksheet range:', range);

        // First try with raw mode to preserve all data types
        const rawJson = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: true,
          defval: null,
        });

        if (!Array.isArray(rawJson) || rawJson.length === 0) {
          return resolve({ data: [], fields: [], detectedFields: {} });
        }

        console.log(`Raw data has ${rawJson.length} rows`);

        // Find the first non-empty row to use as headers
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(10, rawJson.length); i++) {
          const row = rawJson[i] as any[];
          if (
            Array.isArray(row) &&
            row.some((cell) => cell !== null && cell !== '')
          ) {
            headerRowIndex = i;
            break;
          }
        }

        console.log(`Using row ${headerRowIndex} as header row`);

        // Extract header names from the header row
        const headerRow = rawJson[headerRowIndex] as any[];
        const headers = headerRow.map((header, idx) => {
          if (header === null || header === undefined || header === '') {
            return `Column_${idx + 1}`;
          }
          return String(header).trim();
        });

        console.log('Excel headers:', headers);

        // Convert all data rows
        const parsedData: PropertyUnit[] = [];

        // Process data rows (after the header row)
        for (let i = headerRowIndex + 1; i < rawJson.length; i++) {
          const row = rawJson[i] as any[];
          if (!Array.isArray(row) || row.length === 0) continue;

          // Skip rows that are completely empty
          if (row.every((cell) => cell === null || cell === '')) continue;

          const item: PropertyUnit = {};
          let emptyCount = 0;

          // Map values using header names
          headers.forEach((header, idx) => {
            if (idx < row.length) {
              const value = row[idx];

              // Count empty fields
              if (value === null || value === undefined || value === '') {
                emptyCount++;
              }

              item[header] = value;
            } else {
              item[header] = '';
              emptyCount++;
            }
          });

          // Skip rows where more than 50% of fields are empty (more lenient approach)
          if (emptyCount > headers.length * 0.5) {
            console.log(
              `Skipping row ${i} with ${emptyCount}/${headers.length} empty fields`,
            );
            continue;
          }

          parsedData.push(item);
        }

        console.log(`Processed ${parsedData.length} Excel rows`);

        // Log the first row to verify field count
        if (parsedData.length > 0) {
          console.log(
            'First parsed Excel row fields:',
            Object.keys(parsedData[0]).join(', '),
          );
          console.log(
            `Excel row has ${Object.keys(parsedData[0]).length} fields`,
          );
        }

        // Detect field types
        const detectedFields: Record<
          string,
          { type: string; label: string; example: any }
        > = {};

        headers.forEach((header) => {
          let example: null | string | number | any = null;
          let type = 'string';

          // Find the first non-empty value
          for (const row of parsedData) {
            const value = row[header];
            if (value !== null && value !== undefined && value !== '') {
              example = value;

              if (typeof value === 'number') {
                type = 'number';
              } else if (!isNaN(Number(value)) && String(value).trim() !== '') {
                type = 'number';
                example = Number(value);
              }

              break;
            }
          }

          // Generate a readable label
          const label = header
            .replace(/^Column_/, 'Column ')
            .split(/[_\s]/)
            .map(
              (word) =>
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
            )
            .join(' ');

          detectedFields[header] = {
            type,
            label,
            example,
          };
        });

        resolve({
          data: parsedData,
          fields: headers,
          detectedFields,
        });
      } catch (error) {
        console.error('Error parsing Excel:', error);
        reject(
          new Error(
            `Failed to parse Excel: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    };

    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      reject(error);
    };

    reader.readAsArrayBuffer(file);
  });
}

export async function parseFile(file: File): Promise<ParseResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  if (extension === 'csv') {
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = async (e) => {
        const csvString = e.target?.result as string;
        try {
          const result = await parseCSV(csvString);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = (error) => {
        reject(error);
      };

      reader.readAsText(file);
    });
  } else if (['xls', 'xlsx'].includes(extension)) {
    return parseExcel(file);
  }

  throw new Error(`Unsupported file extension: ${extension}`);
}

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

    // Extract headers from the first row
    const headers = rows[0].split(bestDelimiter).map((h) => {
      // Clean up headers - trim and handle quoted values
      const cleaned = h.trim().replace(/^["'](.+)["']$/, '$1');
      return cleaned || `Column${Math.random().toString(36).substring(2, 7)}`;
    });

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

export async function parseExcel(
  file: Express.Multer.File,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    try {
      // Use the buffer directly from the Multer file object
      const data = new Uint8Array(file.buffer);

      // Try parsing with different options to find the best approach
      const workbook = XLSX.read(data, {
        type: 'array',
        cellDates: true, // Properly handle dates
        cellText: false, // Don't convert to text unnecessarily
      });

      // Get the first sheet
      const firstSheetName = workbook.SheetNames[0];

      const worksheet = workbook.Sheets[firstSheetName];

      // First try with raw mode to preserve all data types
      const rawJson = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        defval: null,
      });

      if (!Array.isArray(rawJson) || rawJson.length === 0) {
        return resolve({ data: [], fields: [], detectedFields: {} });
      }

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

      // Extract header names from the header row
      const headerRow = rawJson[headerRowIndex] as any[];
      const headers = headerRow.map((header, idx) => {
        if (header === null || header === undefined || header === '') {
          return `Column_${idx + 1}`;
        }
        return String(header).trim();
      });

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
          continue;
        }

        parsedData.push(item);
      }

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
  });
}

// Add this function to your file

export function mergeUnitsByName(data: PropertyUnit[]): PropertyUnit[] {
  // Group all units by their name
  const groupedByName: Record<string, PropertyUnit[]> = {};

  // Use "Unit Name" as the key for merging
  data.forEach((unit) => {
    const unitName = unit['Unit Name'];
    if (!unitName) return; // Skip entries without a unit name

    if (!groupedByName[unitName]) {
      groupedByName[unitName] = [];
    }
    groupedByName[unitName].push(unit);
  });

  // Merge each group into a single unit
  const mergedUnits: PropertyUnit[] = [];

  Object.keys(groupedByName).forEach((unitName) => {
    const units = groupedByName[unitName];

    // If only one entry exists, no need to merge
    if (units.length === 1) {
      mergedUnits.push(units[0]);
      return;
    }

    // Create a merged unit starting with the first unit's data
    const mergedUnit: PropertyUnit = { ...units[0] };

    // Merge in data from other units in the group
    for (let i = 1; i < units.length; i++) {
      const unit = units[i];

      // For each property in the current unit
      Object.keys(unit).forEach((key) => {
        const currentValue = unit[key];

        // Skip null/empty values
        if (
          currentValue === null ||
          currentValue === undefined ||
          currentValue === ''
        ) {
          return;
        }

        // If the merged unit doesn't have this property or it's empty, use the current value
        if (
          mergedUnit[key] === null ||
          mergedUnit[key] === undefined ||
          mergedUnit[key] === ''
        ) {
          mergedUnit[key] = currentValue;
          return;
        }

        // Both have values - decide how to merge
        // If both are numbers, sum them
        if (
          typeof currentValue === 'number' &&
          typeof mergedUnit[key] === 'number'
        ) {
          // Only sum certain fields - add fields you want to sum here
          const fieldsToSum = [
            'Unit Price',
            'Finishing price',
            'Final Total Unit Price',
            'Building Plot Area',
            'Unit Gross Area',
            'Land Area',
            'Garden Area',
            'Sellable Unit Area',
            'Maintenance Fees per SQM',
            'Maintenance Value',
            'Amenities (Club)',
            'Parking Price',
          ];

          if (fieldsToSum.includes(key)) {
            mergedUnit[key] += currentValue;
          }
          // For non-summable fields, keep the first value (already done)
        }
        // For different string values, combine them
        else if (
          typeof currentValue === 'string' &&
          typeof mergedUnit[key] === 'string' &&
          currentValue !== mergedUnit[key]
        ) {
          mergedUnit[key] = `${mergedUnit[key]}, ${currentValue}`;
        }
      });
    }

    mergedUnits.push(mergedUnit);
  });

  return mergedUnits;
}

export async function parseFile(
  file: Express.Multer.File,
): Promise<ParseResult> {
  const extension = file?.originalname?.split('.').pop()?.toLowerCase() || '';

  let result: ParseResult;

  if (extension === 'csv') {
    // Use Node.js Buffer directly instead of FileReader
    const csvString = file.buffer.toString('utf-8');
    result = await parseCSV(csvString);
  } else if (['xls', 'xlsx'].includes(extension)) {
    result = await parseExcel(file);
  } else {
    throw new Error(`Unsupported file extension: ${extension}`);
  }

  // Merge units with the same name
  const mergedData = mergeUnitsByName(result.data);
  // Return the merged data
  return {
    ...result,
    data: mergedData,
  };
}

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
    let headers = rows[0].split(bestDelimiter).map((h) => {
      // Clean up headers - trim and handle quoted values
      return h.trim().replace(/^["'](.+)["']$/, '$1');
    });

    // Track the indexes of valid headers
    const validHeaderIndexes = headers
      .map((header, index) => {
        // Check if header is empty or auto-generated
        return header && !header.startsWith('Column') ? index : -1;
      })
      .filter((index) => index !== -1);

    // Filter out empty or auto-generated headers
    headers = headers.filter(
      (header) => header && !header.startsWith('Column'),
    );

    // Parse the data rows
    const data: PropertyUnit[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].trim();
      if (!row) continue; // Skip empty rows

      const values = row.split(bestDelimiter);
      const item: PropertyUnit = {};

      // Only process valid headers
      headers.forEach((header, headerIndex) => {
        // Get the original index from the source file
        const originalIndex = validHeaderIndexes[headerIndex];
        let value =
          originalIndex < values.length ? values[originalIndex].trim() : '';

        // Remove quotes if present
        value = value.replace(/^["'](.+)["']$/, '$1');

        // Only add non-empty values
        if (value !== '') {
          item[header] = value;
        }
      });

      // Only add rows that have at least one value
      if (Object.keys(item).length > 0) {
        data.push(item);
      }
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

      // Track valid header indexes and names
      const validHeaders: string[] = [];
      const validHeaderIndexes: number[] = [];

      headerRow.forEach((header, idx) => {
        // Only include headers that have actual names (not auto-generated or empty)
        if (header !== null && header !== undefined && header !== '') {
          validHeaders.push(String(header).trim());
          validHeaderIndexes.push(idx);
        }
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

        // Map values using only valid headers
        validHeaders.forEach((header, idx) => {
          const originalIndex = validHeaderIndexes[idx];

          if (originalIndex < row.length) {
            const value = row[originalIndex];

            // Count empty fields
            if (value === null || value === undefined || value === '') {
              emptyCount++;
            } else {
              item[header] = value;
            }
          }
        });

        // Skip rows where more than 50% of fields are empty (more lenient approach)
        if (emptyCount > validHeaders.length * 0.5) {
          continue;
        }

        // Only add rows that have at least one value
        if (Object.keys(item).length > 0) {
          parsedData.push(item);
        }
      }

      // Detect field types
      const detectedFields: Record<
        string,
        { type: string; label: string; example: any }
      > = {};

      validHeaders.forEach((header) => {
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
        fields: validHeaders,
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
